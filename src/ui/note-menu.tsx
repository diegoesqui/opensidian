import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentType } from 'preact';
import {
  IconCheck,
  IconClock,
  IconLock,
  IconMore,
  IconPreview,
  IconPrinter,
  IconRaw
} from './icons';
import { openHistory } from './history-panel';
import {
  editorMode,
  MODE_HINT,
  MODE_LABEL,
  setEditorMode,
  type EditorMode
} from '../editor/mode';

const isMac = /Mac/i.test(navigator.platform);
const modKey = isMac ? '⌘' : 'Ctrl+';

const MODE_ICON: Record<EditorMode, ComponentType<{ size?: number }>> = {
  live: IconPreview,
  raw: IconRaw,
  read: IconLock
};

const MODES: EditorMode[] = ['live', 'raw', 'read'];

/**
 * Menú de acciones de la nota abierta (los tres puntos de la cabecera).
 * Existe para que la cabecera no se llene de botones sueltos: cada acción
 * nueva que actúe "sobre esta nota" entra aquí en vez de añadir otro icono
 * permanente al lado del título.
 */
export function NoteMenu({ path, onPrint }: { path: string; onPrint: () => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const mode = editorMode.value;

  // Cerrar al pulsar fuera o con Escape. Se escucha en `pointerdown` y no en
  // `click` para que el menú desaparezca en cuanto se pulsa en otro sitio,
  // sin quedarse abierto durante el arrastre de una selección de texto.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const run = (action: () => void) => {
    setOpen(false);
    action();
  };

  return (
    <div class="note-menu" ref={root}>
      <button
        class="icon note-menu-btn"
        title="Más acciones"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <IconMore />
      </button>
      {open && (
        <div class="menu-popup" role="menu">
          {/* Issue #32. Los tres modos van aquí, en el menú de la nota, y no
              como un botón permanente en la cabecera: se cambian de vez en
              cuando, y este menú es justo el sitio de las acciones "sobre
              esta nota". Van arriba del todo y separados del resto porque
              son un estado, no una acción de una vez. */}
          <div class="menu-section-title">Modo {modKey}E</div>
          {MODES.map((m) => {
            const Icon = MODE_ICON[m];
            const active = m === mode;
            return (
              <button
                key={m}
                class={`menu-item mode-item${active ? ' active' : ''}`}
                role="menuitemradio"
                aria-checked={active}
                title={MODE_HINT[m]}
                onClick={() => run(() => setEditorMode(m))}
              >
                <Icon />
                <span>{MODE_LABEL[m]}</span>
                {active && <IconCheck size={14} />}
              </button>
            );
          })}
          <div class="menu-sep" />
          <button class="menu-item" role="menuitem" onClick={() => run(onPrint)}>
            <IconPrinter />
            <span>Imprimir…</span>
          </button>
          <button class="menu-item" role="menuitem" onClick={() => run(() => openHistory(path))}>
            <IconClock />
            <span>Historial de versiones</span>
          </button>
        </div>
      )}
    </div>
  );
}
