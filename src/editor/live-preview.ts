import { syntaxTree } from '@codemirror/language';
import type { Extension, Range } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType
} from '@codemirror/view';

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

const hide = Decoration.replace({});
const lineClass = (cls: string) => Decoration.line({ class: cls });

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

          case 'ListMark': {
            if (isSel) break;
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
        }
      }
    });
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
