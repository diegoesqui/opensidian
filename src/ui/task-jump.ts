import { signal } from '@preact/signals';
import { EditorView } from '@codemirror/view';
import { openNote } from '../state';

/**
 * Salto pendiente hacia una posición concreta de una nota (issue #11: clic en
 * una tarea de la vista de pendientes debe abrir su nota Y dejar el cursor en
 * esa línea, no solo abrir la nota). openNote() solo admite una ruta, así que
 * este módulo guarda el destino exacto y NoteView lo consume en cuanto monta
 * el editor de esa nota (mismo salto que hace outline.tsx a un encabezado,
 * pero diferido porque aquí el editor aún no existe cuando se pide el salto).
 */
export const pendingJump = signal<{ path: string; pos: number } | null>(null);

export function openNoteAt(path: string, pos: number): void {
  pendingJump.value = { path, pos };
  openNote(path);
}

/** Aplica el salto pendiente si es para `path`; se llama al montar el editor de esa nota. */
export function consumePendingJump(path: string, view: EditorView): void {
  const jump = pendingJump.value;
  if (!jump || jump.path !== path) return;
  pendingJump.value = null;
  const pos = Math.min(jump.pos, view.state.doc.length);
  const scroller = view.dom.closest('.main');
  scroller?.classList.add('scroll-suave');
  view.dispatch({
    selection: { anchor: pos },
    effects: EditorView.scrollIntoView(pos, { y: 'center', yMargin: 20 })
  });
  view.focus();
  setTimeout(() => scroller?.classList.remove('scroll-suave'), 700);
}
