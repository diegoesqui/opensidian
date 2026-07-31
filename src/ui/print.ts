import type { EditorState } from '@codemirror/state';
import type { Vault } from '../fs/vault';
import { renderNoteToHtml } from '../editor/print-render';

const CONTAINER_CLASS = 'print-note-container';

// Una imagen rota o muy lenta del vault no debe bloquear la impresión para
// siempre: pasado esto se imprime igualmente (el <img> se queda sin `src`,
// ver renderNoteToHtml/renderImage).
const IMAGE_TIMEOUT_MS = 4000;

function afterDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let printing = false;

/**
 * Issue #14: prepara el markdown de la nota como HTML aparte (ver
 * editor/print-render.ts -el editor virtualiza el viewport y no sirve para
 * imprimir tal cual-) y dispara el diálogo de impresión del navegador.
 *
 * El contenedor se monta como hijo directo de <body>, oculto en pantalla y
 * visible solo dentro de @media print (ver el bloque "Impresión" al final de
 * styles.css, que también oculta el resto de la interfaz y fuerza el tema
 * claro). Se retira en el evento 'afterprint' -que dispara tanto al imprimir
 * como al cancelar el diálogo- para no dejar un árbol duplicado vivo en la
 * página.
 */
export function printNote(title: string, state: EditorState, vault: Vault | null): void {
  if (printing) return; // evita abrir el diálogo dos veces si se hace doble clic en el botón
  printing = true;

  const { root, ready, revoke } = renderNoteToHtml(state, vault);

  const container = document.createElement('div');
  container.className = CONTAINER_CLASS;

  const heading = document.createElement('h1');
  heading.className = 'print-note-title';
  heading.textContent = title;

  container.appendChild(heading);
  container.appendChild(root);
  document.body.appendChild(container);

  const cleanup = () => {
    container.remove();
    revoke();
    window.removeEventListener('afterprint', cleanup);
    printing = false;
  };
  window.addEventListener('afterprint', cleanup);

  void Promise.race([ready, afterDelay(IMAGE_TIMEOUT_MS)]).then(() => window.print());
}
