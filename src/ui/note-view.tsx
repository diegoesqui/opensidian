import { useEffect, useRef, useState } from 'preact/hooks';
import { titleOf, parentOf } from '../util';
import { renameNoteTitle, vaultError } from '../state';
import { MarkdownEditor } from './markdown-editor';

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
  return (
    <div class="note-view">
      <header class="note-header">
        {parent && <span class="note-crumb">{parent.replace(/\//g, ' / ')} /</span>}
        <EditableTitle key={path} path={path} />
        {vaultError.value && <p class="error">{vaultError.value}</p>}
      </header>
      <MarkdownEditor key={path} path={path} autofocus />
    </div>
  );
}
