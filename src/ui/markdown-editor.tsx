import { useEffect, useRef } from 'preact/hooks';
import type { EditorView } from '@codemirror/view';
import { openOrCreateWikiLink, vault } from '../state';
import { createEditor } from '../editor/editor';
import { linkClickHandling } from '../editor/live-preview';
import { wikiLinkAutocomplete } from '../editor/wikilink-autocomplete';
import { headingsTracker, type Heading } from '../editor/headings';
import { isDeleted, registerFlusher, registerReloader } from '../editor/autosave';
import { filePaths, notifySaved } from '../search';
import { titleOf } from '../util';

interface Props {
  path: string;
  autofocus?: boolean;
  placeholder?: string;
  /** Expone el EditorView al padre (p. ej. para que el índice flotante pueda saltar a un encabezado). */
  onEditor?: (view: EditorView | null) => void;
  /** Notifica los encabezados de la nota cada vez que cambian, para alimentar el índice. */
  onHeadings?: (headings: Heading[]) => void;
  /** Índice del encabezado en el que está el cursor (-1 si va antes del primero). */
  onActiveHeading?: (index: number) => void;
}

/**
 * Editor markdown ligado a un archivo del vault: carga el contenido,
 * guarda con debounce mientras se escribe y recarga si el archivo
 * cambia en disco al recuperar el foco.
 */
export function MarkdownEditor({
  path,
  autofocus,
  placeholder,
  onEditor,
  onHeadings,
  onActiveHeading
}: Props) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const v = vault.value;
    const parent = host.current;
    if (!v || !parent) return;

    let view: EditorView | null = null;
    let disposed = false;
    let dirty = false;
    let reloading = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let knownMtime: number | null = null;

    const save = async () => {
      if (!view || !dirty || isDeleted(path)) return;
      dirty = false;
      const text = view.state.doc.toString();
      try {
        await v.writeFile(path, text);
        knownMtime = await v.lastModified(path);
        notifySaved(path, text);
      } catch (e) {
        dirty = true;
        console.error('Error guardando', path, e);
      }
    };

    const onChange = () => {
      if (reloading) return;
      dirty = true;
      clearTimeout(timer);
      timer = setTimeout(() => void save(), 500);
    };

    const unregister = registerFlusher(save);

    void (async () => {
      let content = '';
      try {
        content = await v.readFile(path);
      } catch {
        // nota aún sin archivo: se creará al primer guardado
      }
      knownMtime = await v.lastModified(path);
      if (disposed) return;
      view = createEditor({
        parent,
        content,
        onDocChanged: onChange,
        placeholder,
        extraExtensions: [
          linkClickHandling((title) => void openOrCreateWikiLink(title)),
          wikiLinkAutocomplete(() => filePaths.value.map(titleOf)),
          ...(onHeadings ? [headingsTracker(onHeadings, onActiveHeading ?? (() => {}))] : [])
        ]
      });
      onEditor?.(view);
      if (autofocus) view.focus();
    })();

    // Recarga desde disco si cambió por fuera de este editor (otra pestaña,
    // sincronización, o -issue #8- la reescritura de enlaces al renombrar
    // otra nota). Se usa tanto al recuperar el foco de la ventana como desde
    // el canal explícito de autosave.ts, para no depender de ese foco.
    const reloadIfChanged = async () => {
      if (!view || dirty || isDeleted(path)) return;
      const mtime = await v.lastModified(path);
      if (mtime === null || mtime === knownMtime) return;
      const content = await v.readFile(path);
      if (!view) return;
      if (content !== view.state.doc.toString()) {
        reloading = true;
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: content } });
        reloading = false;
      }
      knownMtime = mtime;
    };
    window.addEventListener('focus', reloadIfChanged);
    const unregisterReloader = registerReloader(path, reloadIfChanged);

    return () => {
      disposed = true;
      clearTimeout(timer);
      void save();
      unregister();
      unregisterReloader();
      window.removeEventListener('focus', reloadIfChanged);
      onEditor?.(null);
      view?.destroy();
      view = null;
    };
  }, [path]);

  return <div class="editor-host" ref={host} />;
}
