import type { Extension } from '@codemirror/state';
import { EditorView, ViewPlugin } from '@codemirror/view';

type FlushFn = () => Promise<void> | void;
type ReloadFn = () => Promise<void> | void;

const flushers = new Set<FlushFn>();
const deletedPaths = new Set<string>();
const reloaders = new Map<string, ReloadFn>();

/**
 * Editor con el foco ahora mismo (issue #22): acciones que necesitan "el
 * editor activo" sin que se les pase por props -como insertar una plantilla
 * en el cursor desde el selector global, ver src/ui/template-insert.tsx- lo
 * leen de aquí. No vale una única referencia guardada en un componente
 * porque el editor activo puede estar en NoteView o en cualquiera de los
 * editores que monta a la vez JournalView (uno por día).
 */
let activeEditor: EditorView | null = null;

/**
 * Último editor que tuvo el foco, aunque ahora mismo no lo tenga. Hace falta
 * porque **pulsar un botón de la interfaz desenfoca el editor antes de que
 * corra el onClick**: al hacer clic en «Insertar plantilla» de la barra
 * lateral, el mousedown deja activeEditor en null y la acción creía que no
 * había ninguna nota abierta (con el atajo de teclado no pasaba, porque el
 * foco no se mueve). Se limpia cuando ese editor se destruye, no cuando
 * pierde el foco.
 */
let lastFocusedEditor: EditorView | null = null;

/** Editores montados ahora mismo. Sirve de último recurso: si solo hay uno
 * (el caso de NoteView), es el destino evidente aunque nunca se haya clicado
 * dentro. Con varios (JournalView monta uno por día) no se adivina. */
const mountedEditors = new Set<EditorView>();

export function setActiveEditor(view: EditorView | null) {
  activeEditor = view;
  if (view) lastFocusedEditor = view;
}

export function getActiveEditor(): EditorView | null {
  return activeEditor;
}

/**
 * Editor sobre el que debe actuar una acción global lanzada desde fuera del
 * editor (un botón, un menú). A diferencia de getActiveEditor(), sobrevive a
 * que el propio clic haya quitado el foco al editor.
 */
export function getTargetEditor(): EditorView | null {
  if (activeEditor) return activeEditor;
  if (lastFocusedEditor && mountedEditors.has(lastFocusedEditor)) return lastFocusedEditor;
  if (mountedEditors.size === 1) return [...mountedEditors][0];
  return null;
}

/** Extensión que mantiene activeEditor al día según el foco del propio
 * CodeMirror (update.focusChanged/view.hasFocus, el mismo mecanismo que ya
 * usan live-preview.ts, image-preview.ts y format-toolbar.ts) y lleva la
 * cuenta de qué editores existen. Se añade a cada MarkdownEditor montado. */
export function activeEditorTracking(): Extension {
  return [
    // Destruir la vista no dispara un focusChanged (no es una transición de
    // foco, es que el editor deja de existir), así que la limpieza de las
    // referencias cuelga del destroy del plugin.
    ViewPlugin.define((view) => {
      mountedEditors.add(view);
      return {
        destroy() {
          mountedEditors.delete(view);
          if (activeEditor === view) activeEditor = null;
          if (lastFocusedEditor === view) lastFocusedEditor = null;
        }
      };
    }),
    EditorView.updateListener.of((update) => {
      if (!update.focusChanged) return;
      if (update.view.hasFocus) setActiveEditor(update.view);
      else if (activeEditor === update.view) activeEditor = null;
    })
  ];
}

export function registerFlusher(fn: FlushFn): () => void {
  flushers.add(fn);
  return () => flushers.delete(fn);
}

/** Guarda inmediatamente todo lo que tenga cambios pendientes. */
export async function flushAll(): Promise<void> {
  await Promise.allSettled([...flushers].map((fn) => fn()));
}

// Se indexa por ruta porque la vista de diario monta varios editores a la vez
// (uno por día), así que no vale una única referencia global.
export function registerReloader(path: string, fn: ReloadFn): () => void {
  reloaders.set(path, fn);
  return () => {
    if (reloaders.get(path) === fn) reloaders.delete(path);
  };
}

/**
 * Avisa de que `path` cambió en disco por una operación ajena al propio
 * editor (p. ej. la reescritura de enlaces al renombrar otra nota). Si esa
 * nota está abierta ahora mismo, se recarga sin esperar a un foco/desenfoque
 * de la ventana -si no, el próximo autoguardado de ese editor sobrescribiría
 * el cambio con el contenido antiguo que aún tiene en memoria-.
 */
export async function notifyExternalChange(path: string): Promise<void> {
  await reloaders.get(path)?.();
}

// Un editor abierto sobre una nota recién borrada no debe "resucitarla"
// al hacer flush en su desmontaje.
export function markDeleted(path: string) {
  deletedPaths.add(path);
}

/**
 * Deja de considerar borrado a `path`. Quita también las marcas de sus
 * carpetas antecesoras, porque isDeleted() empareja por prefijo: si se borró
 * la carpeta «Trabajo» y luego vuelve a existir algo en «Trabajo/Nota.md»
 * (restaurado de la papelera, movido ahí, o creado de nuevo), la marca vieja
 * de la carpeta seguiría dando ese archivo por borrado y su editor **dejaría
 * de guardar en silencio**.
 */
export function unmarkDeleted(path: string) {
  for (const d of deletedPaths) {
    if (path === d || path.startsWith(d + '/')) deletedPaths.delete(d);
  }
}

export function isDeleted(path: string): boolean {
  for (const d of deletedPaths) {
    if (path === d || path.startsWith(d + '/')) return true;
  }
  return false;
}

export function initAutosaveHooks() {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushAll();
  });
  window.addEventListener('beforeunload', () => {
    void flushAll();
  });
}
