import { Prec, type Extension } from '@codemirror/state';
import { EditorView, KeyBinding, ViewPlugin, keymap, type ViewUpdate } from '@codemirror/view';
import {
  bulletListCommand,
  checklistCommand,
  currentHeadingLevel,
  numberedListCommand,
  setHeadingCommand
} from './block-format';

/** Envuelve o desenvuelve la selección con un marcador markdown (negrita, cursiva…). */
function toggleWrap(view: EditorView, marker: string): boolean {
  const { state } = view;
  const sel = state.selection.main;
  if (sel.empty || state.readOnly) return false;
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

interface ButtonSpec {
  label: string;
  title: string;
  class: string;
  run: (view: EditorView) => boolean;
}

const inlineSpecs: ButtonSpec[] = [
  { label: 'N', title: 'Negrita (Ctrl/⌘+B)', class: 'ft-bold', run: (v) => toggleWrap(v, '**') },
  { label: 'C', title: 'Cursiva (Ctrl/⌘+I)', class: 'ft-italic', run: (v) => toggleWrap(v, '*') },
  { label: 'T', title: 'Tachado', class: 'ft-strike', run: (v) => toggleWrap(v, '~~') },
  { label: '</>', title: 'Código', class: 'ft-code', run: (v) => toggleWrap(v, '`') }
];

const blockSpecs: ButtonSpec[] = [
  { label: '•', title: 'Lista con viñetas', class: 'ft-bullet', run: bulletListCommand },
  { label: '1.', title: 'Lista numerada', class: 'ft-numbered', run: numberedListCommand },
  { label: '☑', title: 'Checkbox (Ctrl/⌘+Enter)', class: 'ft-check', run: checklistCommand }
];

const HEADING_LEVELS = [1, 2, 3];

/** Barra de formato flotante que aparece sobre el texto seleccionado. */
class FormatToolbarWidget {
  dom: HTMLElement;
  private headingButtons: { level: number; el: HTMLButtonElement }[] = [];
  // Mientras la selección permanezca en la misma línea, la barra no se
  // reposiciona: así al pulsar el selector de título (que reajusta el tamaño
  // del texto) el botón no se mueve bajo el cursor.
  private anchorLine: number | null = null;
  private onScroll = () => this.reposition();

  constructor(readonly view: EditorView) {
    this.dom = document.createElement('div');
    this.dom.className = 'format-toolbar';
    this.dom.style.display = 'none';

    for (const level of HEADING_LEVELS) {
      const btn = this.makeButton(
        `H${level}`,
        `Título nivel ${level}`,
        'ft-heading',
        setHeadingCommand(level)
      );
      this.headingButtons.push({ level, el: btn });
    }
    this.addSeparator();
    for (const spec of inlineSpecs) this.makeButton(spec.label, spec.title, spec.class, spec.run);
    this.addSeparator();
    for (const spec of blockSpecs) this.makeButton(spec.label, spec.title, spec.class, spec.run);

    document.body.appendChild(this.dom);
    view.scrollDOM.addEventListener('scroll', this.onScroll, { passive: true });
    window.addEventListener('resize', this.onScroll);
  }

  private makeButton(
    label: string,
    title: string,
    cls: string,
    run: (view: EditorView) => boolean
  ): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.title = title;
    btn.className = `ft-btn ${cls}`;
    // mousedown (no click) + preventDefault: evita que el editor pierda el
    // foco/la selección antes de aplicar el formato.
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      run(this.view);
    });
    this.dom.appendChild(btn);
    return btn;
  }

  private addSeparator() {
    const sep = document.createElement('span');
    sep.className = 'ft-sep';
    this.dom.appendChild(sep);
  }

  private updateActiveHeading() {
    const level = currentHeadingLevel(this.view.state);
    for (const { level: lvl, el } of this.headingButtons) {
      el.classList.toggle('active', lvl === level);
    }
  }

  /** Reacciona a cambios de selección/documento decidiendo si recolocar la barra. */
  sync() {
    const sel = this.view.state.selection.main;
    // En solo lectura (issue #32) se puede seleccionar texto para copiarlo,
    // pero la barra no debe aparecer: sus botones escriben en el documento.
    if (sel.empty || !this.view.hasFocus || this.view.state.readOnly) {
      this.dom.style.display = 'none';
      this.anchorLine = null;
      return;
    }
    const line = this.view.state.doc.lineAt(sel.head).number;
    if (line !== this.anchorLine) {
      // Selección en una línea distinta (o recién mostrada): recolocar.
      this.anchorLine = line;
      this.reposition();
    }
    // Misma línea: mantener posición; solo refrescar el título activo.
    this.updateActiveHeading();
  }

  // view.coordsAtPos() solo puede leerse en la fase de medición de CodeMirror
  // (requestMeasure); llamarlo dentro de update() lanza "Reading the editor
  // layout isn't allowed during an update" y desactiva el plugin.
  reposition() {
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
        this.updateActiveHeading();
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
    this.view.scrollDOM.removeEventListener('scroll', this.onScroll);
    window.removeEventListener('resize', this.onScroll);
    this.dom.remove();
  }
}

export function formatToolbar(): Extension {
  return ViewPlugin.fromClass(
    class {
      widget: FormatToolbarWidget;
      constructor(view: EditorView) {
        this.widget = new FormatToolbarWidget(view);
        this.widget.sync();
      }
      update(update: ViewUpdate) {
        if (update.selectionSet || update.docChanged || update.focusChanged) {
          this.widget.sync();
        }
      }
      destroy() {
        this.widget.destroy();
      }
    }
  );
}
