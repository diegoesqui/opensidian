import { Prec, type Extension } from '@codemirror/state';
import { EditorView, KeyBinding, ViewPlugin, keymap, type ViewUpdate } from '@codemirror/view';
import { bulletListCommand, checklistCommand, headingCommand, numberedListCommand } from './block-format';

/** Envuelve o desenvuelve la selección con un marcador markdown (negrita, cursiva…). */
function toggleWrap(view: EditorView, marker: string): boolean {
  const { state } = view;
  const sel = state.selection.main;
  if (sel.empty) return false;
  const mLen = marker.length;
  const text = state.sliceDoc(sel.from, sel.to);

  if (text.startsWith(marker) && text.endsWith(marker) && text.length >= mLen * 2) {
    const inner = text.slice(mLen, text.length - mLen);
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: inner },
      selection: { anchor: sel.from, head: sel.from + inner.length }
    });
    return true;
  }

  const before = state.sliceDoc(Math.max(0, sel.from - mLen), sel.from);
  const after = state.sliceDoc(sel.to, sel.to + mLen);
  if (before === marker && after === marker) {
    view.dispatch({
      changes: [
        { from: sel.from - mLen, to: sel.from, insert: '' },
        { from: sel.to, to: sel.to + mLen, insert: '' }
      ],
      selection: { anchor: sel.from - mLen, head: sel.to - mLen }
    });
    return true;
  }

  view.dispatch({
    changes: [
      { from: sel.from, insert: marker },
      { from: sel.to, insert: marker }
    ],
    selection: { anchor: sel.from + mLen, head: sel.to + mLen }
  });
  return true;
}

const bindings: KeyBinding[] = [
  { key: 'Mod-b', run: (v) => toggleWrap(v, '**') },
  { key: 'Mod-i', run: (v) => toggleWrap(v, '*') }
];

export function formatKeymap(): Extension {
  // Prec.highest: defaultKeymap ya liga Mod-i a otro comando (indent), que
  // ganaría siempre si no forzamos prioridad aquí.
  return Prec.highest(keymap.of(bindings));
}

interface FormatButtonSpec {
  label: string;
  title: string;
  class: string;
  run: (view: EditorView) => boolean;
}

const buttonSpecs: FormatButtonSpec[] = [
  { label: 'H', title: 'Título (H1 → H2 → H3 → ninguno)', class: 'ft-heading', run: headingCommand },
  { label: 'N', title: 'Negrita (Ctrl/⌘+B)', class: 'ft-bold', run: (v) => toggleWrap(v, '**') },
  { label: 'C', title: 'Cursiva (Ctrl/⌘+I)', class: 'ft-italic', run: (v) => toggleWrap(v, '*') },
  { label: 'T', title: 'Tachado', class: 'ft-strike', run: (v) => toggleWrap(v, '~~') },
  { label: '</>', title: 'Código', class: 'ft-code', run: (v) => toggleWrap(v, '`') },
  { label: '•', title: 'Lista con viñetas', class: 'ft-bullet', run: bulletListCommand },
  { label: '1.', title: 'Lista numerada', class: 'ft-numbered', run: numberedListCommand },
  { label: '☑', title: 'Checkbox (Ctrl/⌘+Enter)', class: 'ft-check', run: checklistCommand }
];

/** Barra de formato flotante que aparece sobre el texto seleccionado. */
class FormatToolbarWidget {
  dom: HTMLElement;

  constructor(readonly view: EditorView) {
    this.dom = document.createElement('div');
    this.dom.className = 'format-toolbar';
    this.dom.style.display = 'none';
    for (const spec of buttonSpecs) {
      const btn = document.createElement('button');
      btn.textContent = spec.label;
      btn.title = spec.title;
      btn.className = `ft-btn ${spec.class}`;
      // mousedown (no click) + preventDefault: evita que el editor pierda el
      // foco/la selección antes de aplicar el formato.
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        spec.run(this.view);
      });
      this.dom.appendChild(btn);
    }
    document.body.appendChild(this.dom);
    this.scheduleReposition();
  }

  // view.coordsAtPos() solo puede leerse en la fase de medición de CodeMirror
  // (requestMeasure); llamarlo directamente dentro de update() hace que el
  // plugin entero se desactive con "Reading the editor layout isn't allowed
  // during an update".
  scheduleReposition() {
    this.view.requestMeasure<{ top: number; left: number } | null>({
      read: (view) => {
        const sel = view.state.selection.main;
        if (sel.empty || !view.hasFocus) return null;
        const start = view.coordsAtPos(sel.from);
        const end = view.coordsAtPos(sel.to);
        if (!start || !end) return null;
        return { top: Math.min(start.top, end.top), left: (start.left + end.left) / 2 };
      },
      write: (measured) => {
        if (!measured) {
          this.dom.style.display = 'none';
          return;
        }
        this.dom.style.display = 'flex';
        const width = this.dom.offsetWidth;
        const height = this.dom.offsetHeight;
        const clampedLeft = Math.max(
          8,
          Math.min(measured.left - width / 2, window.innerWidth - width - 8)
        );
        this.dom.style.left = `${clampedLeft}px`;
        this.dom.style.top = `${measured.top - height - 8}px`;
      }
    });
  }

  destroy() {
    this.dom.remove();
  }
}

export function formatToolbar(): Extension {
  return ViewPlugin.fromClass(
    class {
      widget: FormatToolbarWidget;
      constructor(view: EditorView) {
        this.widget = new FormatToolbarWidget(view);
      }
      update(update: ViewUpdate) {
        if (update.selectionSet || update.docChanged || update.focusChanged || update.geometryChanged) {
          this.widget.scheduleReposition();
        }
      }
      destroy() {
        this.widget.destroy();
      }
    }
  );
}
