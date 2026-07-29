import { useEffect, useRef, useState } from 'preact/hooks';
import { EditorView } from '@codemirror/view';
import { titleOf, parentOf } from '../util';
import { renameNoteTitle, vaultError } from '../state';
import { MarkdownEditor } from './markdown-editor';
import { Toc } from './toc';
import type { Heading } from '../editor/headings';

function EditableTitle({ path }: { path: string }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(titleOf(path));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setValue(titleOf(path));
    setEditing(false);
  }, [path]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  if (!editing) {
    return (
      <h1 class="note-title editable" title="Clic para renombrar" onClick={() => setEditing(true)}>
        {titleOf(path)}
      </h1>
    );
  }

  const commit = () => {
    setEditing(false);
    const trimmed = value.trim();
    if (trimmed && trimmed !== titleOf(path)) void renameNoteTitle(path, trimmed);
    else setValue(titleOf(path));
  };

  return (
    <form
      class="note-title-form"
      onSubmit={(e) => {
        e.preventDefault();
        commit();
      }}
    >
      <input
        ref={inputRef}
        class="note-title-input"
        value={value}
        onInput={(e) => setValue((e.target as HTMLInputElement).value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setValue(titleOf(path));
            setEditing(false);
          }
        }}
        onBlur={commit}
      />
    </form>
  );
}

export function NoteView({ path }: { path: string }) {
  const parent = parentOf(path);
  const rootRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<EditorView | null>(null);
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [tocRight, setTocRight] = useState<number | null>(null);

  // El índice es un overlay `position: fixed` (para no desplazarse con el
  // scroll de la nota), pero anclado al borde derecho real de la vista de
  // nota (columna centrada de 46rem), no al de la ventana: recalculamos
  // solo su posición horizontal cuando cambia el ancho disponible (p. ej.
  // al plegar la barra lateral o redimensionar la ventana). La vertical
  // es una constante en CSS, ya que `.main` no se desplaza como bloque.
  useEffect(() => {
    const el = rootRef.current;
    const container = el?.parentElement;
    if (!el || !container) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      setTocRight(Math.max(8, window.innerWidth - rect.right + 8));
    };
    measure();
    const obs = new ResizeObserver(measure);
    obs.observe(container);
    window.addEventListener('resize', measure);
    return () => {
      obs.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  // Al cambiar de nota, MarkdownEditor se remonta (key={path}) pero NoteView
  // no: sin esto, el índice de la nota anterior quedaría visible un instante
  // mientras se carga el contenido de la nueva.
  useEffect(() => {
    setHeadings([]);
    editorRef.current = null;
  }, [path]);

  // El scroll suave se activa solo mientras dura el salto. Dejarlo puesto en
  // `.main` animaría también el scroll con el que CodeMirror sigue al cursor
  // al escribir cerca del borde del viewport, y eso se percibe como lentitud.
  const jump = (pos: number) => {
    const view = editorRef.current;
    if (!view) return;
    const scroller = rootRef.current?.parentElement;
    scroller?.classList.add('scroll-suave');
    view.dispatch({
      selection: { anchor: pos },
      effects: EditorView.scrollIntoView(pos, { y: 'start', yMargin: 20 })
    });
    view.focus();
    setTimeout(() => scroller?.classList.remove('scroll-suave'), 700);
  };

  return (
    <div class="note-view" ref={rootRef}>
      <header class="note-header">
        {parent && <span class="note-crumb">{parent.replace(/\//g, ' / ')} /</span>}
        <EditableTitle key={path} path={path} />
        {vaultError.value && <p class="error">{vaultError.value}</p>}
      </header>
      <MarkdownEditor
        key={path}
        path={path}
        autofocus
        onEditor={(v) => (editorRef.current = v)}
        onHeadings={setHeadings}
      />
      {tocRight !== null && <Toc headings={headings} onJump={jump} right={tocRight} />}
    </div>
  );
}
