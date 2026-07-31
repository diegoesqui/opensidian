import { useEffect, useRef, useState } from 'preact/hooks';
import { titleOf, parentOf } from '../util';
import { renameNoteTitle, vault, vaultError } from '../state';
import { MarkdownEditor } from './markdown-editor';
import { clearOutline, outlineActive, outlineEditor, outlineHeadings } from './outline';
import { Backlinks } from './backlinks';
import { consumePendingJump } from './task-jump';
import { printNote } from './print';
import { NoteMenu } from './note-menu';

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

  // El índice se alimenta por señales porque vive fuera de esta vista (es una
  // columna hermana de `.main`). Se vacía al cambiar de nota y al cerrarla,
  // para que no quede visible el índice de la anterior.
  useEffect(() => clearOutline, [path]);

  // Issue #14: se imprime el estado EN MEMORIA del editor (outlineEditor),
  // no lo último guardado en disco -así no hace falta esperar al autoguardado
  // con debounce (autosave.ts) ni arriesgar una carrera con él-. El propio
  // editor no sirve para imprimir tal cual: virtualiza el viewport y solo
  // mantiene en el DOM las líneas visibles (ver editor/print-render.ts).
  const handlePrint = () => {
    const editorView = outlineEditor.value;
    if (!editorView) return;
    printNote(titleOf(path), editorView.state, vault.value);
  };

  return (
    <div class="note-view">
      <header class="note-header">
        <div class="note-header-top">
          {parent && <span class="note-crumb">{parent.replace(/\//g, ' / ')} /</span>}
          <NoteMenu path={path} onPrint={handlePrint} />
        </div>
        <EditableTitle key={path} path={path} />
        {vaultError.value && <p class="error">{vaultError.value}</p>}
      </header>
      <MarkdownEditor
        key={path}
        path={path}
        autofocus
        onEditor={(v) => {
          outlineEditor.value = v;
          // Si se llegó aquí desde la vista de tareas (issue #11), el salto a
          // la línea concreta se queda pendiente hasta que el editor existe.
          if (v) consumePendingJump(path, v);
        }}
        onHeadings={(h) => (outlineHeadings.value = h)}
        onActiveHeading={(i) => (outlineActive.value = i)}
      />
      <Backlinks path={path} />
    </div>
  );
}
