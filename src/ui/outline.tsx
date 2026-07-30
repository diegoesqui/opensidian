import { signal } from '@preact/signals';
import { EditorView } from '@codemirror/view';
import type { Heading } from '../editor/headings';
import { outlineCollapsed, toggleOutline } from './layout';

/**
 * Índice de la nota activa, como columna del layout a la derecha (mismo
 * patrón que la barra lateral izquierda: panel plano, sin sombra, plegable a
 * un raíl estrecho).
 *
 * El panel vive fuera de NoteView porque es una columna hermana de `.main`,
 * así que la nota le pasa sus encabezados y su editor por estas señales en
 * vez de por props.
 */
export const outlineHeadings = signal<Heading[]>([]);
export const outlineActive = signal(-1);
export const outlineEditor = signal<EditorView | null>(null);

export function clearOutline() {
  outlineHeadings.value = [];
  outlineActive.value = -1;
  outlineEditor.value = null;
}

const INDENT_PER_LEVEL = 12;
// La sangría se escribe como estilo inline y pisa el padding lateral del CSS,
// así que el margen del nivel 1 hay que sumarlo aquí.
const BASE_INDENT = 8;

function OutlineIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <line x1="2" y1="3.2" x2="14" y2="3.2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
      <line x1="5" y1="6.7" x2="14" y2="6.7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
      <line x1="5" y1="10.2" x2="14" y2="10.2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
      <line x1="8" y1="13.7" x2="14" y2="13.7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
    </svg>
  );
}

/**
 * Lleva el editor hasta un encabezado y deja el cursor ahí, listo para
 * escribir. El scroll suave se activa solo mientras dura el salto: dejarlo
 * puesto en `.main` animaría también el scroll con el que CodeMirror sigue al
 * cursor al escribir cerca del borde del viewport, y eso se nota como
 * lentitud.
 */
function jumpTo(pos: number) {
  const view = outlineEditor.value;
  if (!view) return;
  const scroller = view.dom.closest('.main');
  scroller?.classList.add('scroll-suave');
  view.dispatch({
    selection: { anchor: pos },
    effects: EditorView.scrollIntoView(pos, { y: 'start', yMargin: 20 })
  });
  view.focus();
  setTimeout(() => scroller?.classList.remove('scroll-suave'), 700);
}

export function Outline() {
  if (outlineCollapsed.value) {
    return (
      <aside class="outline collapsed">
        <button class="icon rail-btn" title="Mostrar índice" onClick={toggleOutline}>
          <OutlineIcon />
        </button>
      </aside>
    );
  }

  const headings = outlineHeadings.value;
  const active = outlineActive.value;
  return (
    <aside class="outline">
      <div class="outline-header">
        <span class="outline-title">Índice</span>
        <button class="icon" title="Ocultar índice" onClick={toggleOutline}>
          <OutlineIcon />
        </button>
      </div>
      {headings.length === 0 ? (
        <p class="outline-empty">Esta nota no tiene encabezados.</p>
      ) : (
        <ul class="outline-list">
          {headings.map((h, i) => (
            <li
              key={i}
              class={i === active ? 'outline-item active' : 'outline-item'}
              style={{ paddingLeft: `${BASE_INDENT + (h.level - 1) * INDENT_PER_LEVEL}px` }}
              title={h.text}
              // preventDefault en mousedown para que el clic no le robe el
              // foco al editor (mismo patrón que la barra de formato).
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => jumpTo(h.pos)}
            >
              {h.text || '(sin título)'}
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
