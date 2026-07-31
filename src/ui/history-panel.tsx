import { signal } from '@preact/signals';
import { useEffect, useState } from 'preact/hooks';
import { flushAll } from '../editor/autosave';
import { getVersions, restoreVersion, type HistoryVersion } from '../history';
import { vault, vaultError } from '../state';
import { titleOf } from '../util';
import { IconClock, IconX } from './icons';

/**
 * Ruta de la nota cuyo historial se muestra, o null si el panel está
 * cerrado (issue #15). Mismo patrón que trashOpen en trash.tsx: señal
 * exportada del propio módulo, renderizada desde app.tsx junto al resto de
 * modales; aquí lleva la ruta en vez de un booleano porque el panel es por
 * nota, no global.
 */
export const historyPath = signal<string | null>(null);

export function openHistory(path: string): void {
  historyPath.value = path;
}

function formatWhen(ts: number): string {
  return new Date(ts).toLocaleString('es-ES', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

type DiffOp = { type: 'equal' | 'add' | 'remove'; text: string };

/**
 * Diff por líneas entre dos versiones, para la vista de comparación. LCS con
 * programación dinámica: para una nota normal (unas pocas centenas de
 * líneas) el coste O(n·m) es instantáneo. Si alguna de las dos es enorme, se
 * evita construir una tabla gigante y se cae a un diff "sin memoria" (todo lo
 * de la versión antigua marcado como quitado, todo lo de la actual como
 * añadido): pierde precisión en ese caso límite, pero no bloquea la pestaña.
 */
function diffLines(oldText: string, newText: string): DiffOp[] {
  const a = oldText.split('\n');
  const b = newText.split('\n');
  const n = a.length;
  const m = b.length;
  if (n * m > 400_000) {
    return [
      ...a.map((text) => ({ type: 'remove' as const, text })),
      ...b.map((text) => ({ type: 'add' as const, text }))
    ];
  }
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: 'equal', text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: 'remove', text: a[i] });
      i++;
    } else {
      ops.push({ type: 'add', text: b[j] });
      j++;
    }
  }
  while (i < n) ops.push({ type: 'remove', text: a[i++] });
  while (j < m) ops.push({ type: 'add', text: b[j++] });
  return ops;
}

export function HistoryPanel() {
  const path = historyPath.value!;
  const [versions, setVersions] = useState<HistoryVersion[] | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState(false);

  const close = () => (historyPath.value = null);

  const load = async () => {
    const v = vault.value;
    if (!v) return;
    // Que "la versión actual" sea de verdad la última escrita, no la que
    // hubiera a medio guardar hace menos de 500 ms.
    await flushAll();
    const [vs, curContent] = await Promise.all([getVersions(path), v.readFile(path).catch(() => '')]);
    setVersions(vs);
    setCurrent(curContent);
    setSelected(0);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  const restore = async () => {
    const v = vault.value;
    const chosen = versions?.[selected];
    if (!v || !chosen) return;
    const aviso =
      'Restaurar esta versión sobrescribe el contenido actual de la nota. ' +
      'Quedará guardada como una versión nueva del historial, así que también se podrá deshacer. ¿Continuar?';
    if (!confirm(aviso)) return;
    setBusy(true);
    await restoreVersion(v, path, chosen);
    await load(); // el propio restaurar añadió una versión: refresca la lista
    setBusy(false);
  };

  const chosen = versions?.[selected];
  const ops = chosen && current !== null ? diffLines(chosen.content, current) : [];
  const noDiff = ops.length > 0 && ops.every((op) => op.type === 'equal');

  return (
    <div class="modal-backdrop" onClick={close}>
      <div class="modal history-modal" onClick={(e) => e.stopPropagation()}>
        <div class="history-header">
          <span class="history-title">
            <IconClock size={15} />
            Historial · {titleOf(path)}
          </span>
          <button class="icon" title="Cerrar" onClick={close}>
            <IconX size={15} />
          </button>
        </div>
        <p class="history-disclaimer">
          Esto no es una copia de seguridad: las versiones se guardan solo en este navegador y
          desaparecen si se borra el perfil de Chrome o la nota se abre desde otro equipo.
        </p>
        {vaultError.value && <p class="error">{vaultError.value}</p>}
        {versions === null && <p class="muted">Cargando…</p>}
        {versions && versions.length === 0 && (
          <p class="muted">Todavía no hay versiones guardadas de esta nota.</p>
        )}
        {versions && versions.length > 0 && (
          <div class="history-body">
            <ul class="history-versions">
              {versions.map((v, i) => (
                <li key={v.ts} class={i === selected ? 'sel' : ''} onClick={() => setSelected(i)}>
                  {formatWhen(v.ts)}
                </li>
              ))}
            </ul>
            <div class="history-diff">
              {/* Sin esta leyenda el diff es ambiguo justo cuando más
                  importa: los colores van en el sentido "versión elegida ->
                  nota actual", así que lo verde es lo que se PERDERÍA al
                  restaurar, al revés de lo que sugiere el verde a primera
                  vista. */}
              {!noDiff && (
                <p class="history-diff-legend">
                  <span class="diff-swatch diff-remove">Rojo</span>: la versión elegida ·{' '}
                  <span class="diff-swatch diff-add">Verde</span>: la nota ahora, que se
                  sustituiría al restaurar
                </p>
              )}
              {noDiff && <p class="muted">Sin diferencias con la versión actual.</p>}
              {!noDiff &&
                ops.map((op, i) => (
                  <div key={i} class={`history-diff-line diff-${op.type}`}>
                    {op.text || ' '}
                  </div>
                ))}
            </div>
          </div>
        )}
        <div class="history-footer">
          <button class="btn subtle small" disabled={!versions?.length || busy} onClick={() => void restore()}>
            Restaurar esta versión
          </button>
        </div>
      </div>
    </div>
  );
}
