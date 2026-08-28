import { signal } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import {
  activeTag,
  createFolder,
  createNote,
  currentPath,
  deleteEntry,
  moveEntry,
  openNote,
  quickOpen,
  renameEntry,
  switchVault,
  trashEntries,
  tree,
  vault,
  vaultError,
  view
} from '../state';
import type { VaultEntry } from '../fs/vault';
import { exportZip } from '../fs/export';
import { parentOf } from '../util';
import { cycleTheme, ThemeIcon, themeLabel } from './theme';
import { sidebarCollapsed, toggleSidebar } from './layout';
import { JOURNAL_DIR } from './journal';
import { trashOpen } from './trash';
import { openTemplatePicker } from './template-insert';
import { openHistory } from './history-panel';
import { updateAvailable } from '../update-check';
import {
  IconCalendar,
  IconCheckSquare,
  IconClock,
  IconDownload,
  IconUpdate,
  IconFile,
  IconFolderOpen,
  IconFolderPlus,
  IconPencil,
  IconPlus,
  IconSearch,
  IconTag,
  IconTemplate,
  IconTrash,
  IconX
} from './icons';

/** Icono de panel lateral (distinto del de cambiar de carpeta, para no confundirlos). */
function SidebarToggleIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" stroke="currentColor" stroke-width="1.3" />
      <line x1="6" y1="2.5" x2="6" y2="13.5" stroke="currentColor" stroke-width="1.3" />
      <rect x="2.6" y="4" width="2.4" height="8" rx="0.5" fill="currentColor" />
    </svg>
  );
}

type Editing =
  | { type: 'new-note' | 'new-folder'; dir: string }
  | { type: 'rename'; path: string };

const editing = signal<Editing | null>(null);

/**
 * Carpetas plegadas del árbol: la clave es la ruta, y una ruta ausente
 * significa desplegada. `journal/` arranca plegada (issue #33) porque crece
 * a una nota por día: desplegada llena la barra lateral entera y empuja el
 * resto de notas fuera de la vista, y además el diario se lee desde su propia
 * vista (Cmd/Ctrl+J), no desde el árbol.
 *
 * Es solo el estado INICIAL: en cuanto el usuario la abre o la cierra, manda
 * lo que él haya elegido durante el resto de la sesión.
 */
const collapsed = signal<Record<string, boolean>>({ [JOURNAL_DIR]: true });

const isMac = /Mac/i.test(navigator.platform);
const mod = isMac ? '⌘' : 'Ctrl+';

// Drag & drop de notas/carpetas en el árbol. `dropTarget` usa '' para la raíz.
const draggingEntry = signal<VaultEntry | null>(null);
const dropTarget = signal<string | null>(null);

function canDropOn(dir: string): boolean {
  const d = draggingEntry.value;
  if (!d) return false;
  if (parentOf(d.path) === dir) return false; // ya está ahí
  if (d.kind === 'dir' && (dir === d.path || dir.startsWith(d.path + '/'))) return false;
  return true;
}

function endDrag() {
  draggingEntry.value = null;
  dropTarget.value = null;
}

function dragHandlers(entry: VaultEntry) {
  return {
    draggable: true,
    onDragStart: (e: DragEvent) => {
      draggingEntry.value = entry;
      e.dataTransfer?.setData('text/plain', entry.path);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    },
    onDragEnd: endDrag
  };
}

/** Handlers de zona de destino para una carpeta (o '' para la raíz del árbol). */
function dropHandlers(dir: string) {
  return {
    onDragOver: (e: DragEvent) => {
      if (!canDropOn(dir)) return;
      e.preventDefault();
      e.stopPropagation();
      dropTarget.value = dir;
    },
    onDragLeave: (e: DragEvent) => {
      e.stopPropagation();
      if (dropTarget.value === dir) dropTarget.value = null;
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const d = draggingEntry.value;
      const ok = canDropOn(dir);
      endDrag();
      if (d && ok) void moveEntry(d, dir);
    }
  };
}

function NameInput({
  initial,
  placeholder,
  onCommit
}: {
  initial: string;
  placeholder?: string;
  onCommit: (value: string | null) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const commit = (value: string | null) => {
    if (done.current) return;
    done.current = true;
    onCommit(value);
  };
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <form
      class="name-form"
      onSubmit={(e) => {
        e.preventDefault();
        commit(ref.current?.value ?? null);
      }}
    >
      <input
        ref={ref}
        class="name-input"
        value={initial}
        placeholder={placeholder}
        onKeyDown={(e) => {
          if (e.key === 'Escape') commit(null);
        }}
        onBlur={(e) => commit((e.target as HTMLInputElement).value || null)}
      />
    </form>
  );
}

function NewEntryRow({ type, dir, depth }: { type: 'new-note' | 'new-folder'; dir: string; depth: number }) {
  return (
    <div class="row" style={{ paddingLeft: `${depth * 14 + 26}px` }}>
      <NameInput
        initial=""
        placeholder={type === 'new-note' ? 'Nombre de la nota' : 'Nombre de la carpeta'}
        onCommit={(value) => {
          editing.value = null;
          if (!value?.trim()) return;
          if (type === 'new-note') void createNote(dir, value);
          else void createFolder(dir, value);
        }}
      />
    </div>
  );
}

function RowActions({ entry }: { entry: VaultEntry }) {
  return (
    <span class="row-actions">
      {entry.kind === 'dir' && (
        <>
          <button
            class="icon"
            title="Nueva nota aquí"
            onClick={(e) => {
              e.stopPropagation();
              collapsed.value = { ...collapsed.value, [entry.path]: false };
              editing.value = { type: 'new-note', dir: entry.path };
            }}
          >
            <IconPlus size={14} />
          </button>
          <button
            class="icon"
            title="Nueva carpeta aquí"
            onClick={(e) => {
              e.stopPropagation();
              collapsed.value = { ...collapsed.value, [entry.path]: false };
              editing.value = { type: 'new-folder', dir: entry.path };
            }}
          >
            <IconFolderPlus size={14} />
          </button>
        </>
      )}
      {entry.kind === 'file' && (
        <button
          class="icon"
          title="Historial de versiones"
          onClick={(e) => {
            e.stopPropagation();
            openHistory(entry.path);
          }}
        >
          <IconClock size={14} />
        </button>
      )}
      <button
        class="icon"
        title="Renombrar"
        onClick={(e) => {
          e.stopPropagation();
          editing.value = { type: 'rename', path: entry.path };
        }}
      >
        <IconPencil size={14} />
      </button>
      <button
        class="icon danger"
        title="Eliminar"
        onClick={(e) => {
          e.stopPropagation();
          const what = entry.kind === 'dir' ? 'la carpeta y todo su contenido' : 'la nota';
          if (confirm(`¿Eliminar ${what} «${entry.name}»?`)) void deleteEntry(entry);
        }}
      >
        <IconX size={14} />
      </button>
    </span>
  );
}

function TreeNode({ entry, depth }: { entry: VaultEntry; depth: number }) {
  const ed = editing.value;
  const renaming = ed?.type === 'rename' && ed.path === entry.path;
  const pad = `${depth * 14 + 8}px`;
  const isDragging = draggingEntry.value?.path === entry.path;

  if (entry.kind === 'dir') {
    const isCollapsed = collapsed.value[entry.path] ?? false;
    const isDropTarget = dropTarget.value === entry.path;
    return (
      <div>
        <div
          class={`row dir${isDragging ? ' dragging' : ''}${isDropTarget ? ' drag-over' : ''}`}
          style={{ paddingLeft: pad }}
          onClick={() =>
            (collapsed.value = { ...collapsed.value, [entry.path]: !isCollapsed })
          }
          {...(renaming ? {} : dragHandlers(entry))}
          {...dropHandlers(entry.path)}
        >
          <span class="twisty">{isCollapsed ? '▸' : '▾'}</span>
          {renaming ? (
            <NameInput
              initial={entry.name}
              onCommit={(value) => {
                editing.value = null;
                if (value) void renameEntry(entry, value);
              }}
            />
          ) : (
            <span class="label">{entry.name}</span>
          )}
          <RowActions entry={entry} />
        </div>
        {!isCollapsed && (
          <div>
            {ed && ed.type !== 'rename' && ed.dir === entry.path && (
              <NewEntryRow type={ed.type} dir={ed.dir} depth={depth + 1} />
            )}
            {entry.children?.map((child) => (
              <TreeNode key={child.path} entry={child} depth={depth + 1} />
            ))}
          </div>
        )}
      </div>
    );
  }

  const active = currentPath.value === entry.path && view.value === 'note';
  return (
    <div
      class={`row file${active ? ' active' : ''}${isDragging ? ' dragging' : ''}`}
      style={{ paddingLeft: pad }}
      onClick={() => openNote(entry.path)}
      {...(renaming ? {} : dragHandlers(entry))}
      onDragOver={(e: DragEvent) => e.stopPropagation()}
    >
      <span class="file-icon">·</span>
      {renaming ? (
        <NameInput
          initial={entry.name}
          onCommit={(value) => {
            editing.value = null;
            if (value) void renameEntry(entry, value);
          }}
        />
      ) : (
        <span class="label">{entry.name.replace(/\.md$/i, '')}</span>
      )}
      <RowActions entry={entry} />
    </div>
  );
}

function CollapsedRail() {
  return (
    <aside class="sidebar collapsed">
      <button class="icon rail-btn" title="Mostrar panel lateral" onClick={toggleSidebar}>
        <SidebarToggleIcon />
      </button>
      <button
        class="icon rail-btn"
        title="Diario"
        onClick={() => {
          sidebarCollapsed.value = false;
          toggleSidebar();
          view.value = 'journal';
        }}
      >
        <IconCalendar size={17} />
      </button>
      <button
        class="icon rail-btn"
        title="Abrir nota"
        onClick={() => (quickOpen.value = true)}
      >
        <IconFile size={17} />
      </button>
    </aside>
  );
}

export function Sidebar() {
  if (sidebarCollapsed.value) return <CollapsedRail />;

  const t = tree.value;
  const v = vault.value!;
  const ed = editing.value;
  return (
    <aside class="sidebar">
      <div class="vault-row">
        <button class="icon" title="Ocultar panel lateral" onClick={toggleSidebar}>
          <SidebarToggleIcon />
        </button>
        <span class="vault-name" title={v.name}>
          {v.name}
        </span>
        <button class="icon" title={themeLabel()} onClick={cycleTheme}>
          <ThemeIcon />
        </button>
      </div>
      {/* Aquí y no en una vista concreta (NoteView, JournalView...): la barra
          lateral es lo único que se ve siempre, y errores como "no hay
          editor enfocado" al insertar una plantilla (issue #22) pueden
          dispararse desde cualquier vista, incluida Buscar/Tareas/Etiquetas,
          que hasta ahora no mostraban vaultError en ningún sitio. */}
      {vaultError.value && <p class="error sidebar-error">{vaultError.value}</p>}
      <nav class="nav">
        <button
          class={view.value === 'journal' ? 'nav-btn active' : 'nav-btn'}
          onClick={() => (view.value = 'journal')}
        >
          <span class="nav-label">
            <IconCalendar />
            Diario
          </span>
          <kbd>{mod}J</kbd>
        </button>
        <button
          class={view.value === 'search' ? 'nav-btn active' : 'nav-btn'}
          onClick={() => (view.value = 'search')}
        >
          <span class="nav-label">
            <IconSearch />
            Buscar
          </span>
          <kbd>{mod}⇧F</kbd>
        </button>
        <button
          class={view.value === 'tasks' ? 'nav-btn active' : 'nav-btn'}
          onClick={() => (view.value = 'tasks')}
        >
          <span class="nav-label">
            <IconCheckSquare />
            Tareas
          </span>
          <kbd>{mod}⇧T</kbd>
        </button>
        <button
          class={view.value === 'tags' ? 'nav-btn active' : 'nav-btn'}
          onClick={() => {
            // Siempre al índice completo, no a un filtro que pudiera haber
            // quedado activo de una visita anterior (igual que Buscar vuelve
            // a nacer en blanco cada vez que se entra).
            activeTag.value = null;
            view.value = 'tags';
          }}
        >
          <span class="nav-label">
            <IconTag />
            Etiquetas
          </span>
        </button>
        <button class="nav-btn" onClick={() => (quickOpen.value = true)}>
          <span class="nav-label">
            <IconFile />
            Abrir nota
          </span>
          <kbd>{mod}K</kbd>
        </button>
        <button class="nav-btn" onClick={() => openTemplatePicker()}>
          <span class="nav-label">
            <IconTemplate />
            Insertar plantilla
          </span>
          <kbd>{mod}⇧P</kbd>
        </button>
      </nav>
      <div class="section-row">
        <span class="section-title">Notas</span>
        <button
          class="icon"
          title="Nueva nota"
          onClick={() => (editing.value = { type: 'new-note', dir: '' })}
        >
          <IconPlus size={15} />
        </button>
        <button
          class="icon"
          title="Nueva carpeta"
          onClick={() => (editing.value = { type: 'new-folder', dir: '' })}
        >
          <IconFolderPlus size={15} />
        </button>
      </div>
      <div class={`tree${dropTarget.value === '' ? ' drag-over-root' : ''}`} {...dropHandlers('')}>
        {ed && ed.type !== 'rename' && ed.dir === '' && (
          <NewEntryRow type={ed.type} dir="" depth={0} />
        )}
        {t?.children?.map((child) => <TreeNode key={child.path} entry={child} depth={0} />)}
        {t && !t.children?.length && !ed && (
          <p class="tree-empty">Todavía no hay notas. Crea la primera con el botón +</p>
        )}
      </div>
      <div class="sidebar-footer">
        <button class="btn subtle small" onClick={() => (trashOpen.value = true)}>
          <IconTrash size={15} />
          Papelera{trashEntries.value.length ? ` (${trashEntries.value.length})` : ''}
        </button>
        <button class="btn subtle small" onClick={() => void switchVault()}>
          <IconFolderOpen size={15} />
          Cambiar carpeta de notas
        </button>
        {v.kind === 'opfs' && (
          <button class="btn subtle small" onClick={() => void exportZip(v)}>
            <IconDownload size={15} />
            Exportar notas (.zip)
          </button>
        )}
        {/*
          Solo aparece cuando hay una version mas nueva publicada. La app no
          puede instalarla sola (ver src/update-check.ts), asi que el boton
          lleva a la pagina de la release para descargarla a mano.
        */}
        {updateAvailable.value && (
          <a
            class="btn subtle small update-link"
            href={updateAvailable.value.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            <IconUpdate size={15} />
            Versión {updateAvailable.value.version} disponible
          </a>
        )}
      </div>
    </aside>
  );
}
