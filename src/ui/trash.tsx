import { signal } from '@preact/signals';
import { useState } from 'preact/hooks';
import { emptyTrash, restoreEntry, trashEntries, vaultError } from '../state';
import type { VaultEntry } from '../fs/vault';

/**
 * Visibilidad del panel de la papelera (issue #10). Vive en este archivo
 * nuevo y no en state.ts -a diferencia de quickOpen, que sí vive allí- para
 * no tocar ese fichero más de lo imprescindible: hay otro trabajo en marcha
 * en paralelo sobre state.ts/sidebar.tsx/app.tsx (vista de tareas
 * pendientes) y cuantas menos líneas compartidas, menos fricción al fusionar.
 */
export const trashOpen = signal(false);

export function TrashPanel() {
  const entries = trashEntries.value;
  const [busy, setBusy] = useState<string | null>(null);

  const close = () => (trashOpen.value = false);

  const restore = async (entry: VaultEntry) => {
    setBusy(entry.path);
    await restoreEntry(entry);
    setBusy(null);
  };

  const empty = async () => {
    if (!entries.length) return;
    const aviso =
      entries.length === 1
        ? '¿Vaciar la papelera? Se borrará para siempre 1 elemento. Esta acción no se puede deshacer.'
        : `¿Vaciar la papelera? Se borrarán para siempre ${entries.length} elementos. Esta acción no se puede deshacer.`;
    if (!confirm(aviso)) return;
    setBusy('*');
    await emptyTrash();
    setBusy(null);
  };

  return (
    <div class="modal-backdrop" onClick={close}>
      <div class="modal trash-modal" onClick={(e) => e.stopPropagation()}>
        <div class="trash-header">
          <span class="trash-title">🗑️ Papelera</span>
          <button class="icon" title="Cerrar" onClick={close}>
            ✕
          </button>
        </div>
        {vaultError.value && <p class="error">{vaultError.value}</p>}
        <ul class="modal-list trash-list">
          {entries.map((entry) => (
            <li key={entry.path}>
              <span class="qs-title">
                {entry.kind === 'dir' ? '📁' : '·'} {entry.name}
              </span>
              <button
                class="btn subtle small"
                disabled={busy === entry.path}
                onClick={() => void restore(entry)}
              >
                Restaurar
              </button>
            </li>
          ))}
          {!entries.length && <li class="qs-none">La papelera está vacía</li>}
        </ul>
        <div class="trash-footer">
          <button
            class="btn subtle small trash-empty-btn"
            disabled={!entries.length || busy === '*'}
            onClick={() => void empty()}
          >
            Vaciar papelera
          </button>
        </div>
      </div>
    </div>
  );
}
