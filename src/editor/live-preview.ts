import { syntaxTree } from '@codemirror/language';
import type { EditorState, Extension, Range } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType
} from '@codemirror/view';
import type { SyntaxNode, SyntaxNodeRef } from '@lezer/common';
import { isRawMode, modeChanged } from './mode';
import { WIKILINK_RE } from '../wikilink';
import { tagsInLine } from '../tags';

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
      // En modo solo lectura (issue #32) el checkbox se ve pero no marca:
      // `EditorState.readOnly` lo consultan los comandos de CodeMirror, pero
      // un dispatch a pelo como este se aplicaría igual.
      if (view.state.readOnly) return;
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

function isInCode(state: EditorState, pos: number): boolean {
  let n: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1);
  while (n) {
    if (
      n.name === 'InlineCode' ||
      n.name === 'FencedCode' ||
      n.name === 'CodeBlock' ||
      n.name === 'CodeText'
    ) {
      return true;
    }
    n = n.parent;
  }
  return false;
}

function build(view: EditorView): DecorationSet {
  const { state } = view;
  // Modo «Código fuente» (issue #32): ni marcadores ocultos, ni viñetas, ni
  // checkboxes, ni enlaces… el texto tal cual está en el archivo.
  if (isRawMode(state)) return Decoration.none;
  const ranges: Range<Decoration>[] = [];
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
          case 'HighlightMark':
          case 'SuperscriptMark':
          case 'SubscriptMark':
            if (!isSel) ranges.push(hide.range(node.from, node.to));
            break;

          // Superíndices `^x^` y subíndices `~x~` (issue #31): el parser ya
          // los reconocía -@codemirror/lang-markdown los activa por defecto,
          // ver editor.ts- y print-render.ts ya los imprimía como <sup>/<sub>,
          // pero en el editor se veían como texto plano con sus marcadores.
          // El realzado es posicional, no un color, así que no puede salir del
          // HighlightStyle (que además da el MISMO tag a los dos nodos): va
          // como decoración de marca, y al contrario que los marcadores se
          // aplica siempre, también en la línea del cursor.
          case 'Superscript':
          case 'Subscript':
            ranges.push(
              Decoration.mark({ class: name === 'Superscript' ? 'cm-sup' : 'cm-sub' }).range(
                node.from,
                node.to
              )
            );
            break;

          // Notas al pie (issue #31, nodo definido en markdown-extras.ts). El
          // mismo nodo es la llamada dentro del texto y la etiqueta de la
          // línea de definición; lo que las distingue es estar al principio de
          // la línea y llevar ":" detrás, y se pintan distinto a propósito: la
          // llamada en volandas como un superíndice, la definición como una
          // etiqueta a ras de línea, porque un "1:" en superíndice se lee mal.
          case 'FootnoteRef': {
            const isDef = node.from === line.from && doc.sliceString(node.to, node.to + 1) === ':';
            ranges.push(
              Decoration.mark({ class: isDef ? 'cm-footnote-label' : 'cm-footnote-ref' }).range(
                node.from,
                node.to
              )
            );
            if (isDef) ranges.push(lineClass('cm-footnote-def').range(line.from));
            break;
          }

          case 'FootnoteMark':
            if (!isSel) ranges.push(hide.range(node.from, node.to));
            break;

          // Autolink `<https://…>` (issue #31): el parser lo reconocía pero
          // nadie lo decoraba, así que se veía con sus ángulos y el
          // Cmd/Ctrl+clic no lo abría (ver linkNodeAt más abajo). Los ángulos
          // son hijos LinkMark del propio nodo, así que se ocultan como
          // cualquier otro marcador.
          case 'Autolink': {
            if (isSel) break;
            const auto = node.node;
            for (const m of auto.getChildren('LinkMark')) ranges.push(hide.range(m.from, m.to));
            ranges.push(Decoration.mark({ class: 'cm-hyperlink' }).range(auto.from, auto.to));
            break;
          }

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

          // `CodeBlock` es el bloque de código por sangría (cuatro espacios),
          // que se pintaba como texto normal: solo se decoraban los de valla
          // ```. Se ven igual a propósito -son lo mismo para markdown-, y
          // marcarlo ayuda a detectar la sangría accidental que convierte un
          // párrafo en código sin querer.
          case 'FencedCode':
          case 'CodeBlock': {
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

          case 'Table':
            // El render de las tablas (como <table> real) vive en su propio
            // archivo, table-preview.ts, en un StateField y no aquí: un
            // ViewPlugin no puede aportar decoraciones de bloque ni
            // decoraciones replace que crucen saltos de línea (Codemirror
            // lanza RangeError y desactiva ESTE plugin entero en silencio,
            // ver el comentario de cabecera de table-preview.ts). Aun así
            // hay que evitar bajar a las celdas: si no, este plugin seguiría
            // generando decoraciones (ocultar **, `, ~~) sobre un rango que
            // el otro StateField ya reemplaza por completo con su widget, y
            // esas dos decoraciones solapadas rompen el render.
            return false;
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

    // Etiquetas #etiqueta (issue #12): tampoco son sintaxis markdown
    // estándar -salvo que el "#" no lleve espacio detrás es justo lo que las
    // distingue de un encabezado ATX, ver el comentario de cabecera de
    // tags.ts-, así que se detectan igual que los wiki-links: regex por
    // línea, evitando código en línea/bloques. A diferencia de los
    // wiki-links no hay nada que ocultar (el "#" se queda visible en el
    // resultado renderizado), así que el mark no depende de si la línea
    // tiene el cursor.
    for (let ln = doc.lineAt(from).number; ln <= doc.lineAt(to).number; ln++) {
      const line = doc.line(ln);
      for (const t of tagsInLine(line.text)) {
        const start = line.from + t.start;
        // isInCode() consulta el árbol de sintaxis, que aquí sí está
        // disponible: cubre los bloques ``` (que tagsInLine no puede ver,
        // porque solo recibe una línea suelta).
        if (isInCode(state, start)) continue;
        ranges.push(Decoration.mark({ class: 'cm-tag' }).range(start, line.from + t.end));
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
        modeChanged(update) ||
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

/**
 * Nodo de enlace que contiene `pos`, sea `[texto](url)` o `<url>`: los dos
 * cuelgan su destino de un hijo `URL`, así que quien los abre no necesita
 * distinguirlos (issue #31).
 */
function linkNodeAt(state: EditorState, pos: number): SyntaxNode | null {
  let n: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1);
  while (n && n.name !== 'Link' && n.name !== 'Autolink') n = n.parent;
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

function tagAt(state: EditorState, pos: number): string | null {
  const line = state.doc.lineAt(pos);
  for (const t of tagsInLine(line.text)) {
    if (pos >= line.from + t.start && pos <= line.from + t.end) {
      return isInCode(state, line.from + t.start) ? null : t.name;
    }
  }
  return null;
}

/** Abre una URL solo si el esquema es uno seguro conocido (evita javascript:/data:). */
function openSafeUrl(raw: string) {
  const url = raw.trim();
  if (/^https?:\/\//i.test(url) || /^mailto:/i.test(url)) {
    window.open(url, '_blank', 'noopener,noreferrer');
  } else if (/^[\w.+-]+@[\w-]+(\.[\w-]+)+$/.test(url)) {
    // Un autolink `<alguien@dominio.com>` llega aquí sin esquema: sin este
    // caso acabaría abriéndose como "https://alguien@dominio.com". Mismo
    // criterio que autolinkHref() en print-render.ts.
    window.open(`mailto:${url}`, '_blank', 'noopener,noreferrer');
  } else if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) {
    window.open(`https://${url}`, '_blank', 'noopener,noreferrer');
  }
}

/**
 * Cmd/Ctrl+clic sobre un enlace `[texto](url)` lo abre en una pestaña nueva;
 * sobre un enlace `[[Nota]]` navega a esa nota (o la crea si no existe);
 * sobre una `#etiqueta` filtra por ella (issue #12). El modificador es el
 * mismo para las tres cosas -y no un clic simple- por lo mismo que ya vale
 * para los wiki-links: un clic normal debe poder colocar el cursor sobre el
 * texto de la etiqueta para editarlo, no navegar fuera del editor.
 */
export function linkClickHandling(
  onWikiLink: (title: string) => void,
  onTag: (name: string) => void
): Extension {
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
      const tag = tagAt(view.state, pos);
      if (tag) {
        event.preventDefault();
        onTag(tag);
        return true;
      }
      return false;
    }
  });
}
