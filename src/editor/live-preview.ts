import { syntaxTree } from '@codemirror/language';
import type { EditorState, Extension, Range, Text } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType
} from '@codemirror/view';
import type { SyntaxNode, SyntaxNodeRef } from '@lezer/common';

/**
 * Live preview estilo Obsidian: los marcadores markdown (#, **, ``, - […])
 * se ocultan o sustituyen por su versión renderizada, salvo en las líneas
 * donde está el cursor, que muestran el texto fuente para poder editarlo.
 */

class CheckboxWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly from: number,
    readonly to: number
  ) {
    super();
  }

  eq(other: CheckboxWidget) {
    return other.checked === this.checked && other.from === this.from && other.to === this.to;
  }

  toDOM(view: EditorView) {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'cm-task-checkbox';
    box.checked = this.checked;
    box.addEventListener('mousedown', (e) => e.preventDefault());
    box.addEventListener('click', (e) => {
      e.preventDefault();
      view.dispatch({
        changes: { from: this.from + 1, to: this.to - 1, insert: this.checked ? ' ' : 'x' }
      });
    });
    return box;
  }

  ignoreEvent() {
    return true;
  }
}

// El widget del bullet/regla horizontal no es "contenteditable": el navegador
// no siempre sabe colocar el cursor de forma fiable al hacer clic justo
// encima (varía entre motores). Por eso calculamos y despachamos la posición
// nosotros mismos en el mousedown, en vez de confiar en la colocación nativa.
function placeCursorOnClick(view: EditorView, pos: number, e: MouseEvent) {
  e.preventDefault();
  view.dispatch({ selection: { anchor: pos }, scrollIntoView: false });
  view.focus();
}

class BulletWidget extends WidgetType {
  constructor(readonly clickPos: number) {
    super();
  }
  eq(other: BulletWidget) {
    return other.clickPos === this.clickPos;
  }
  toDOM(view: EditorView) {
    const span = document.createElement('span');
    span.className = 'cm-bullet';
    span.textContent = '•';
    span.addEventListener('mousedown', (e) => placeCursorOnClick(view, this.clickPos, e));
    return span;
  }
  ignoreEvent() {
    return true;
  }
}

class HrWidget extends WidgetType {
  constructor(readonly clickPos: number) {
    super();
  }
  eq(other: HrWidget) {
    return other.clickPos === this.clickPos;
  }
  toDOM(view: EditorView) {
    const hr = document.createElement('hr');
    hr.className = 'cm-hr-widget';
    hr.addEventListener('mousedown', (e) => placeCursorOnClick(view, this.clickPos, e));
    return hr;
  }
  ignoreEvent() {
    return true;
  }
}

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
    if (node.to > node.from) into.appendChild(document.createTextNode(doc.sliceString(node.from, node.to)));
    return;
  }
  for (; child; child = child.nextSibling) {
    if (child.from > pos) into.appendChild(document.createTextNode(doc.sliceString(pos, child.from)));
    switch (child.name) {
      case 'EmphasisMark':
      case 'CodeMark':
      case 'StrikethroughMark':
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
    wrap.addEventListener('mousedown', (e) => placeCursorOnClick(view, this.from, e));

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

const hide = Decoration.replace({});
const lineClass = (cls: string) => Decoration.line({ class: cls });

// px de sangría extra por cada nivel de anidación de listas (más allá del
// primero), para que la jerarquía de bullets/numeradas se lea a simple vista.
const LIST_INDENT = 22;

function listDepth(node: SyntaxNodeRef): number {
  let n: SyntaxNode | null = node.node.parent;
  let depth = 0;
  while (n) {
    if (n.name === 'BulletList' || n.name === 'OrderedList') depth++;
    n = n.parent;
  }
  return depth;
}

const WIKILINK_RE = /\[\[([^[\]]+)\]\]/g;

function isInCode(state: EditorState, pos: number): boolean {
  let n: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1);
  while (n) {
    if (n.name === 'InlineCode' || n.name === 'FencedCode' || n.name === 'CodeText') return true;
    n = n.parent;
  }
  return false;
}

function build(view: EditorView): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  const { state } = view;
  const doc = state.doc;
  // Sin foco no se revela nada: la selección "fantasma" en la posición 0
  // de un editor inactivo no debe mostrar los marcadores de su primera línea.
  const focused = view.hasFocus;
  const selectedIn = (from: number, to: number) =>
    focused && state.selection.ranges.some((r) => r.to >= from && r.from <= to);

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter(node) {
        const name = node.name;
        const line = doc.lineAt(node.from);
        const isSel = selectedIn(line.from, line.to);

        switch (name) {
          case 'ATXHeading1':
          case 'ATXHeading2':
          case 'ATXHeading3':
          case 'ATXHeading4':
            ranges.push(lineClass(`cm-line-h${name.slice(-1)}`).range(line.from));
            break;

          case 'HeaderMark':
            if (!isSel && node.from === line.from) {
              const end = doc.sliceString(node.to, node.to + 1) === ' ' ? node.to + 1 : node.to;
              ranges.push(hide.range(node.from, end));
            }
            break;

          case 'EmphasisMark':
          case 'StrikethroughMark':
            if (!isSel) ranges.push(hide.range(node.from, node.to));
            break;

          case 'CodeMark':
            if (!isSel && node.node.parent?.name === 'InlineCode') {
              ranges.push(hide.range(node.from, node.to));
            }
            break;

          case 'Link': {
            if (isSel) break;
            const linkNode = node.node;
            const marks = linkNode.getChildren('LinkMark');
            const urlNode = linkNode.getChild('URL');
            const openMark = marks.find((m) => doc.sliceString(m.from, m.to) === '[');
            const closeMark = marks.find((m) => doc.sliceString(m.from, m.to) === ']');
            if (!openMark || !closeMark || !urlNode) break;
            ranges.push(hide.range(openMark.from, openMark.to));
            ranges.push(hide.range(closeMark.from, linkNode.to));
            ranges.push(
              Decoration.mark({
                class: 'cm-hyperlink',
                attributes: { title: doc.sliceString(urlNode.from, urlNode.to) }
              }).range(linkNode.from, linkNode.to)
            );
            break;
          }

          case 'ListMark': {
            const depth = listDepth(node);
            if (depth > 1) {
              ranges.push(
                Decoration.line({
                  attributes: { style: `padding-left: ${(depth - 1) * LIST_INDENT}px` }
                }).range(line.from)
              );
            }
            if (isSel) break;
            if (node.from > line.from) {
              // sustituye la sangría real (espacios) por el padding de arriba
              ranges.push(hide.range(line.from, node.from));
            }
            if (!/^[-*+]$/.test(doc.sliceString(node.from, node.to))) break;
            const after = doc.sliceString(node.to, node.to + 5);
            if (/^\s\[[ xX]\]/.test(after)) {
              // tarea: el checkbox sustituirá al marcador completo
              ranges.push(hide.range(node.from, node.to + 1));
            } else {
              ranges.push(
                Decoration.replace({ widget: new BulletWidget(node.to) }).range(node.from, node.to)
              );
            }
            break;
          }

          case 'TaskMarker': {
            if (isSel) break;
            const checked = /x/i.test(doc.sliceString(node.from, node.to));
            const end = doc.sliceString(node.to, node.to + 1) === ' ' ? node.to + 1 : node.to;
            ranges.push(
              Decoration.replace({
                widget: new CheckboxWidget(checked, node.from, node.to)
              }).range(node.from, end)
            );
            if (checked && end < line.to) {
              ranges.push(Decoration.mark({ class: 'cm-task-done' }).range(end, line.to));
            }
            break;
          }

          case 'Blockquote': {
            const last = doc.lineAt(node.to).number;
            for (let n = line.number; n <= last; n++) {
              ranges.push(lineClass('cm-quote-line').range(doc.line(n).from));
            }
            break;
          }

          case 'QuoteMark':
            if (!isSel) {
              const end = doc.sliceString(node.to, node.to + 1) === ' ' ? node.to + 1 : node.to;
              ranges.push(hide.range(node.from, end));
            }
            break;

          case 'FencedCode': {
            const last = doc.lineAt(node.to).number;
            for (let n = line.number; n <= last; n++) {
              ranges.push(lineClass('cm-codeblock').range(doc.line(n).from));
            }
            break;
          }

          case 'HorizontalRule':
            if (!isSel) {
              ranges.push(
                Decoration.replace({ widget: new HrWidget(node.from) }).range(node.from, node.to)
              );
            }
            break;

          case 'Table': {
            const tableNode = node.node;
            // A diferencia del resto de casos, aquí el criterio de selección
            // debe cubrir la tabla entera (de su primera a su última línea),
            // no solo la línea donde empieza el nodo: si el cursor está en
            // cualquier fila, se edita el markdown fuente de toda la tabla.
            if (selectedIn(tableNode.from, tableNode.to)) break;
            ranges.push(
              Decoration.replace({
                widget: new TableWidget(doc.sliceString(tableNode.from, tableNode.to), tableNode.from),
                block: true
              }).range(tableNode.from, tableNode.to)
            );
            // Evita que se sigan generando decoraciones (EmphasisMark,
            // CodeMark, etc.) para las celdas: ya están representadas en el
            // widget y se solaparían con el rango que acabamos de reemplazar.
            return false;
          }
        }
      }
    });

    // Enlaces entre notas [[Nota]]: no forman parte de la sintaxis markdown
    // estándar, así que no aparecen en el árbol; se detectan con una pasada
    // de regex por línea, evitando código en línea/bloques.
    for (let ln = doc.lineAt(from).number; ln <= doc.lineAt(to).number; ln++) {
      const line = doc.line(ln);
      if (selectedIn(line.from, line.to)) continue;
      WIKILINK_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = WIKILINK_RE.exec(line.text))) {
        const start = line.from + m.index;
        const end = start + m[0].length;
        if (isInCode(state, start)) continue;
        ranges.push(hide.range(start, start + 2));
        ranges.push(hide.range(end - 2, end));
        ranges.push(Decoration.mark({ class: 'cm-wikilink' }).range(start, end));
      }
    }
  }
  return Decoration.set(ranges, true);
}

const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        update.focusChanged ||
        syntaxTree(update.state) !== syntaxTree(update.startState)
      ) {
        this.decorations = build(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations }
);

export function livePreview(): Extension {
  return livePreviewPlugin;
}

function linkNodeAt(state: EditorState, pos: number): SyntaxNode | null {
  let n: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1);
  while (n && n.name !== 'Link') n = n.parent;
  return n;
}

function wikiLinkAt(state: EditorState, pos: number): string | null {
  const line = state.doc.lineAt(pos);
  WIKILINK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WIKILINK_RE.exec(line.text))) {
    const start = line.from + m.index;
    const end = start + m[0].length;
    if (pos >= start && pos <= end) return m[1].trim();
  }
  return null;
}

/** Abre una URL solo si el esquema es uno seguro conocido (evita javascript:/data:). */
function openSafeUrl(raw: string) {
  const url = raw.trim();
  if (/^https?:\/\//i.test(url) || /^mailto:/i.test(url)) {
    window.open(url, '_blank', 'noopener,noreferrer');
  } else if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) {
    window.open(`https://${url}`, '_blank', 'noopener,noreferrer');
  }
}

/**
 * Cmd/Ctrl+clic sobre un enlace `[texto](url)` lo abre en una pestaña nueva;
 * sobre un enlace `[[Nota]]` navega a esa nota (o la crea si no existe).
 */
export function linkClickHandling(onWikiLink: (title: string) => void): Extension {
  return EditorView.domEventHandlers({
    mousedown(event, view) {
      if (!(event.metaKey || event.ctrlKey) || event.button !== 0) return false;
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos == null) return false;
      const linkNode = linkNodeAt(view.state, pos);
      if (linkNode) {
        const urlNode = linkNode.getChild('URL');
        if (urlNode) {
          event.preventDefault();
          openSafeUrl(view.state.sliceDoc(urlNode.from, urlNode.to));
          return true;
        }
      }
      const wiki = wikiLinkAt(view.state, pos);
      if (wiki) {
        event.preventDefault();
        onWikiLink(wiki);
        return true;
      }
      return false;
    }
  });
}
