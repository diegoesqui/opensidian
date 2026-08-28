import { syntaxTree } from '@codemirror/language';
import { type EditorState, type Extension, type Range, StateEffect, StateField, type Text } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';

/**
 * Render de tablas GFM (estilo Obsidian): fuera de las líneas donde está el
 * cursor, cada tabla se sustituye por un <table> real.
 *
 * Esto vive en su propio StateField y NO en el ViewPlugin de live-preview.ts
 * a propósito: CodeMirror prohíbe que un ViewPlugin aporte decoraciones de
 * bloque o decoraciones `replace` que crucen un salto de línea — lanza
 * "Block decorations may not be specified via plugins" / "Decorations that
 * replace line breaks may not be specified via plugins" (comprobación
 * `disallowBlockEffectsFor` en @codemirror/view/dist/index.js, método
 * `emit`). Como una tabla ocupa varias líneas y se sustituye por un widget
 * de bloque, hace falta un StateField (los StateField sí pueden aportar
 * ese tipo de decoraciones). Si esta excepción llega a producirse, se
 * captura en silencio y desactiva el plugin ENTERO: se pierden de golpe
 * encabezados, viñetas, checkboxes, citas y enlaces en toda la nota. No
 * volver a mover este código a un ViewPlugin sin resolver antes ese punto.
 */

type Align = 'left' | 'right' | 'center' | null;

// La fila delimitadora (`| :--- | :---: |`) se representa en el árbol como
// un único nodo TableDelimiter hijo directo de Table (a diferencia de los
// marcadores de pipe de cada fila, que son hijos de TableHeader/TableRow),
// así que basta leer su texto para saber la alineación de cada columna.
function tableAlignment(doc: Text, tableNode: SyntaxNode): Align[] {
  const delim = tableNode.getChild('TableDelimiter');
  if (!delim) return [];
  return doc
    .sliceString(delim.from, delim.to)
    .split('|')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => {
      const left = s.startsWith(':');
      const right = s.endsWith(':');
      if (left && right) return 'center';
      if (right) return 'right';
      if (left) return 'left';
      return null;
    });
}

// Recorre los hijos inline de una celda (o de un nodo de énfasis dentro de
// ella) y construye los nodos DOM equivalentes, omitiendo los marcadores
// (**, `, ~~). Nunca se usa innerHTML: el contenido es del usuario y hay
// que evitar cualquier inyección de HTML.
function renderInline(doc: Text, node: SyntaxNode, into: HTMLElement) {
  let pos = node.from;
  let child = node.firstChild;
  if (!child) {
    // El propio parser de tablas ya recorta los espacios de alrededor del
    // contenido de la celda (ver parseRow en @lezer/markdown), pero se
    // recorta también aquí por seguridad: con text-align: center/right un
    // espacio colado en el borde se nota en el resultado.
    const text = doc.sliceString(node.from, node.to).trim();
    if (text) into.appendChild(document.createTextNode(text));
    return;
  }
  for (; child; child = child.nextSibling) {
    if (child.from > pos) into.appendChild(document.createTextNode(doc.sliceString(pos, child.from)));
    switch (child.name) {
      case 'EmphasisMark':
      case 'CodeMark':
      case 'StrikethroughMark':
      case 'HighlightMark':
      case 'SuperscriptMark':
      case 'SubscriptMark':
      case 'FootnoteMark':
        break; // el marcador no se muestra, solo determina el formato aplicado
      case 'InlineCode': {
        const code = document.createElement('code');
        code.className = 'cm-inline-code';
        renderInline(doc, child, code);
        into.appendChild(code);
        break;
      }
      case 'StrongEmphasis': {
        const strong = document.createElement('strong');
        renderInline(doc, child, strong);
        into.appendChild(strong);
        break;
      }
      case 'Emphasis': {
        const em = document.createElement('em');
        renderInline(doc, child, em);
        into.appendChild(em);
        break;
      }
      case 'Strikethrough': {
        const s = document.createElement('s');
        renderInline(doc, child, s);
        into.appendChild(s);
        break;
      }
      // Resaltado, super/subíndices y notas al pie (issue #31). Dentro de una
      // celda la tabla se dibuja con DOM propio, así que las decoraciones del
      // live preview no llegan aquí: se replica su clase para que un formato
      // se vea igual dentro y fuera de una tabla. Se usan <span> con la misma
      // clase, y no <mark>/<sup>/<sub>, para no arrastrar el amarillo y los
      // tamaños por defecto del navegador.
      case 'Highlight':
      case 'Superscript':
      case 'Subscript':
      case 'FootnoteRef': {
        const cls =
          child.name === 'Highlight'
            ? 'cm-highlight'
            : child.name === 'Superscript'
              ? 'cm-sup'
              : child.name === 'Subscript'
                ? 'cm-sub'
                : 'cm-footnote-ref';
        const span = document.createElement('span');
        span.className = cls;
        renderInline(doc, child, span);
        into.appendChild(span);
        break;
      }
      default:
        renderInline(doc, child, into); // otros nodos (p. ej. enlaces): se conserva su texto
    }
    pos = child.to;
  }
  if (node.to > pos) into.appendChild(document.createTextNode(doc.sliceString(pos, node.to)));
}

function renderTableRow(doc: Text, rowNode: SyntaxNode, align: Align[], cellTag: 'th' | 'td'): HTMLTableRowElement {
  const tr = document.createElement('tr');
  rowNode.getChildren('TableCell').forEach((cell, i) => {
    const el = document.createElement(cellTag);
    if (align[i]) el.style.textAlign = align[i] as string;
    renderInline(doc, cell, el);
    tr.appendChild(el);
  });
  return tr;
}

// Igual que en live-preview.ts: el widget no es "contenteditable", así que
// el clic no coloca el cursor de forma fiable por sí solo; se despacha a
// mano en el mousedown.
function placeCursorOnClick(view: EditorView, pos: number, e: MouseEvent) {
  e.preventDefault();
  view.dispatch({ selection: { anchor: pos }, scrollIntoView: false });
  view.focus();
}

class TableWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly from: number
  ) {
    super();
  }

  // Compara el texto fuente de la tabla, no la posición: así CodeMirror no
  // reconstruye el DOM de la tabla en cada actualización si no ha cambiado.
  eq(other: TableWidget) {
    return other.source === this.source;
  }

  toDOM(view: EditorView) {
    const wrap = document.createElement('div');
    wrap.className = 'cm-table-wrap';
    wrap.addEventListener('mousedown', (e) => {
      // Si el clic no llega a ningún hijo (target === wrap) y cae por
      // debajo del área de contenido real, es la franja de la barra de
      // scroll horizontal: se deja que el navegador la arrastre con
      // normalidad en vez de interceptarlo para colocar el cursor.
      if (e.target === wrap && e.offsetY >= wrap.clientHeight) return;
      placeCursorOnClick(view, this.from, e);
    });

    // El widget solo guarda el texto fuente (para eq) y la posición; el
    // árbol de sintaxis se vuelve a resolver aquí, en el árbol vigente.
    let node: SyntaxNode | null = syntaxTree(view.state).resolveInner(this.from + 1, 1);
    while (node && node.name !== 'Table') node = node.parent;
    if (!node) {
      wrap.textContent = this.source;
      return wrap;
    }

    const doc = view.state.doc;
    const align = tableAlignment(doc, node);
    const table = document.createElement('table');
    table.className = 'cm-table';

    const headerNode = node.getChild('TableHeader');
    if (headerNode) {
      const thead = document.createElement('thead');
      thead.appendChild(renderTableRow(doc, headerNode, align, 'th'));
      table.appendChild(thead);
    }

    const tbody = document.createElement('tbody');
    for (const rowNode of node.getChildren('TableRow')) {
      tbody.appendChild(renderTableRow(doc, rowNode, align, 'td'));
    }
    table.appendChild(tbody);

    wrap.appendChild(table);
    return wrap;
  }

  ignoreEvent() {
    return true;
  }
}

// -------- foco --------
// Un StateField no tiene acceso a `view.hasFocus` (eso es de la vista, no
// del estado). La vista de diario (journal.tsx) monta varios editores a la
// vez, casi todos sin foco: sin este seguimiento, una nota que empiece con
// una tabla mostraría su markdown en crudo mientras no se enfoque, igual
// que el bug que ya se documentó para el resto de marcadores en
// live-preview.ts (selección "fantasma" en la posición 0).
const setFocus = StateEffect.define<boolean>();

const focusField = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setFocus)) value = effect.value;
    }
    return value;
  }
});

// EditorView.focusChangeEffect dispara un efecto en la misma transacción en
// la que el editor gana o pierde el foco, que es lo que alimenta el campo.
const trackFocus = EditorView.focusChangeEffect.of((_state, focusing) => setFocus.of(focusing));

function buildTableDecorations(state: EditorState): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  const doc = state.doc;
  const focused = state.field(focusField, false) ?? false;

  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== 'Table') return;
      const tableNode = node.node;
      // Una decoración replace de bloque debe empezar y terminar justo en
      // límites de línea; se usan los límites de línea en vez de
      // tableNode.from/to en crudo para no depender de dónde acabe
      // exactamente el nodo.
      const from = doc.lineAt(tableNode.from).from;
      const to = doc.lineAt(tableNode.to).to;
      const selInside = focused && state.selection.ranges.some((r) => r.to >= from && r.from <= to);
      if (selInside) return false; // se edita: se muestra el markdown fuente de toda la tabla

      ranges.push(
        Decoration.replace({
          widget: new TableWidget(doc.sliceString(from, to), from),
          block: true
        }).range(from, to)
      );
      return false; // no hace falta descender: la tabla ya está representada por el widget
    }
  });

  return Decoration.set(ranges, true);
}

const tableDecorations = StateField.define<DecorationSet>({
  create: buildTableDecorations,
  update(value, tr) {
    const focusChanged = tr.effects.some((e) => e.is(setFocus));
    if (tr.docChanged || !!tr.selection || focusChanged || syntaxTree(tr.state) !== syntaxTree(tr.startState)) {
      // El árbol de sintaxis puede terminar de actualizarse en una
      // transacción posterior a la propia escritura; sin esta comprobación
      // la tabla no aparecería hasta la siguiente pulsación de tecla.
      return buildTableDecorations(tr.state);
    }
    return value.map(tr.changes);
  },
  provide: (field) => EditorView.decorations.from(field)
});

export function tablePreview(): Extension {
  return [focusField, trackFocus, tableDecorations];
}
