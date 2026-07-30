import { vault } from './state';
import { flushAll, notifyExternalChange } from './editor/autosave';
import { notifySaved } from './search';
import { scanTasks, type TaskItem } from './search/tasks';

/**
 * Alterna el estado de una tarea (issue #11) reescribiendo solo su carácter
 * `[ ]`/`[x]` en el archivo original, sin tocar el resto de la línea ni de la
 * nota. Mismo carácter que toca el checkbox del live preview (live-preview.ts):
 * el hueco entre corchetes.
 *
 * Dos cuidados de sincronización:
 *
 * 1. Si la nota está abierta en un editor con cambios sin guardar (autoguardado
 *    con debounce de 500ms), flushAll() los vuelca a disco antes de leer, para
 *    no perderlos ni calcular la posición sobre contenido desactualizado.
 * 2. Por eso mismo no nos fiamos de `task.checkPos` (calculado antes del
 *    flush): si ese flush cambió texto por encima de esta tarea, la posición
 *    absoluta se habría desplazado. Volvemos a escanear el contenido recién
 *    leído y localizamos la tarea por `idx` (su orden entre los checkboxes de
 *    la nota), que es estable mientras no se añadan o quiten checkboxes por
 *    encima.
 * 3. Tras escribir, notifySaved() actualiza los índices (búsqueda, enlaces y
 *    tareas) y notifyExternalChange() hace que, si esa nota está abierta en
 *    un editor ahora mismo, se recargue sin esperar a un foco/desenfoque de
 *    la ventana -si no, su próximo autoguardado sobrescribiría este cambio
 *    con el contenido antiguo que aún tiene en memoria- (mismo patrón que
 *    updateLinksAfterRename en state.ts).
 */
export async function toggleTask(task: TaskItem): Promise<void> {
  const v = vault.value;
  if (!v) return;
  await flushAll();
  let content: string;
  try {
    content = await v.readFile(task.path);
  } catch (e) {
    console.error('No se pudo leer', task.path, e);
    return;
  }
  const fresh = scanTasks(task.path, content);
  const current = fresh[task.idx];
  if (!current) {
    console.error('La tarea ya no existe en', task.path);
    return;
  }
  const next = current.done ? ' ' : 'x';
  const rewritten =
    content.slice(0, current.checkPos) + next + content.slice(current.checkPos + 1);
  try {
    await v.writeFile(task.path, rewritten);
  } catch (e) {
    console.error('No se pudo guardar', task.path, e);
    return;
  }
  notifySaved(task.path, rewritten);
  await notifyExternalChange(task.path);
}
