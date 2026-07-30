import { useState } from 'preact/hooks';
import { indexReady } from '../search';
import { allTasks, tasksVersion, type TaskItem } from '../search/tasks';
import { toggleTask } from '../tasks';
import { titleOf } from '../util';
import { openNoteAt } from './task-jump';

interface Group {
  path: string;
  title: string;
  items: TaskItem[];
}

/**
 * Agrupa por nota y ordena. Las tareas de cada nota ya vienen en orden de
 * aparición (scanTasks recorre el documento de arriba abajo); las notas se
 * ordenan por ruta descendente, que para el diario (journal/AAAA-MM-DD.md) da
 * el día más reciente primero -mismo criterio que usa JournalView-.
 */
function buildGroups(showDone: boolean): Group[] {
  const byPath = new Map<string, TaskItem[]>();
  for (const t of allTasks()) {
    if (!showDone && t.done) continue;
    const list = byPath.get(t.path);
    if (list) list.push(t);
    else byPath.set(t.path, [t]);
  }
  return [...byPath.keys()]
    .sort()
    .reverse()
    .map((path) => ({ path, title: titleOf(path), items: byPath.get(path)! }));
}

export function TasksPanel() {
  const [showDone, setShowDone] = useState(false);
  // Nos suscribimos a tasksVersion (mismo patrón que backlinksFor/linksVersion)
  // para recalcular los grupos cada vez que el índice de tareas cambia.
  void tasksVersion.value;
  const groups = indexReady.value ? buildGroups(showDone) : [];
  const total = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <div class="tasks-panel">
      <div class="tasks-header">
        <h1>Tareas pendientes</h1>
        <label class="tasks-toggle">
          <input
            type="checkbox"
            checked={showDone}
            onChange={(e) => setShowDone((e.target as HTMLInputElement).checked)}
          />
          Mostrar completadas
        </label>
      </div>
      {!indexReady.value && <p class="muted">Indexando notas…</p>}
      {indexReady.value && total === 0 && (
        <p class="muted">
          {showDone ? 'No hay ninguna tarea en el vault.' : 'No tienes tareas pendientes.'}
        </p>
      )}
      {groups.map((g) => (
        <section key={g.path} class="tasks-group">
          <h2
            class="tasks-group-title"
            title={g.path}
            onClick={() => openNoteAt(g.path, g.items[0].pos)}
          >
            {g.title}
          </h2>
          <ul class="tasks-list">
            {g.items.map((t) => (
              <li key={t.idx} class={t.done ? 'task-item done' : 'task-item'}>
                <input
                  type="checkbox"
                  checked={t.done}
                  // Sin esto el clic en la casilla también dispara el onClick
                  // del texto, que abriría/saltaría la nota además de marcarla.
                  onClick={(e) => e.stopPropagation()}
                  onChange={() => void toggleTask(t)}
                />
                <span class="task-text" onClick={() => openNoteAt(t.path, t.pos)}>
                  {t.text || '(tarea vacía)'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
