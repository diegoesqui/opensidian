import { useState } from 'preact/hooks';
import type { Heading } from '../editor/headings';

interface Props {
  headings: Heading[];
  onJump: (pos: number) => void;
  /** Posición horizontal (px desde el borde derecho), calculada por NoteView según el ancho real de la vista de nota. */
  right: number;
}

const INDENT_PER_LEVEL = 14;

/**
 * Índice flotante de la nota activa. Plegable: colapsado se reduce a un
 * botón compacto para no estorbar en pantallas pequeñas. No se renderiza
 * si la nota no tiene encabezados (un panel vacío sería ruido).
 */
export function Toc({ headings, onJump, right }: Props) {
  const [collapsed, setCollapsed] = useState(false);

  if (headings.length === 0) return null;

  // mousedown con preventDefault (no click) en el contenedor: evita que el
  // clic en el índice le robe el foco/la selección al editor, igual que
  // hace la barra de formato flotante (format-toolbar.ts).
  const keepFocus = (e: MouseEvent) => e.preventDefault();

  if (collapsed) {
    return (
      <div class="toc-panel toc-collapsed" style={{ right }} onMouseDown={keepFocus}>
        <button class="icon toc-toggle" title="Mostrar índice" onClick={() => setCollapsed(false)}>
          ☰
        </button>
      </div>
    );
  }

  return (
    <nav class="toc-panel" style={{ right }} onMouseDown={keepFocus}>
      <div class="toc-header">
        <span class="toc-title">Índice</span>
        <button class="icon toc-toggle" title="Plegar índice" onClick={() => setCollapsed(true)}>
          ✕
        </button>
      </div>
      <ul class="toc-list">
        {headings.map((h, i) => (
          <li
            key={i}
            class="toc-item"
            style={{ paddingLeft: `${(h.level - 1) * INDENT_PER_LEVEL}px` }}
            title={h.text}
            onClick={() => onJump(h.pos)}
          >
            {h.text || '(sin título)'}
          </li>
        ))}
      </ul>
    </nav>
  );
}
