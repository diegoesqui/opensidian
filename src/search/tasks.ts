import { signal } from '@preact/signals';

/**
 * Índice de tareas (checkboxes `- [ ]` / `- [x]`) de todas las notas, para la
 * vista de pendientes (issue #11). Vive junto al índice de MiniSearch y al de
 * enlaces (search/links.ts) por el mismo motivo: reutiliza el recorrido de
 * contenido que ya hace search/index.ts en vez de escanear el vault por su
 * cuenta.
 */

export interface TaskItem {
  /** Nota de origen. */
  path: string;
  /**
   * Orden de esta tarea entre las de su nota (0-based). Sirve de identidad
   * estable al reescribir (ver toggleTask en ../tasks.ts): si el texto por
   * encima cambia de tamaño, la posición absoluta se desplaza pero el orden
   * entre checkboxes no, mientras no se añadan o quiten checkboxes por
   * encima.
   */
  idx: number;
  /** Offset del inicio de la línea en el documento (para saltar a ella). */
  pos: number;
  /** Offset del carácter entre corchetes (' ', 'x' o 'X'), para reescribirlo sin tocar el resto de la línea. */
  checkPos: number;
  /** Texto de la tarea, sin el marcador de lista ni el checkbox. */
  text: string;
  done: boolean;
}

// Línea de lista con checkbox: indentación opcional, marcador -/*/+, espacio,
// [ ]/[x]/[X], espacio opcional y el resto de la línea. Mismo formato que
// reconoce y escribe block-format.ts, para no inventar uno nuevo.
const TASK_LINE_RE = /^[ \t]*[-*+][ \t]+\[([ xX])\][ \t]?(.*)$/gm;

const tasksByNote = new Map<string, TaskItem[]>();

// Se incrementa en cada cambio, igual que linksVersion: los componentes que
// leen allTasks() se suscriben a esta señal para volver a pintarse.
export const tasksVersion = signal(0);

/** Escaneo puro (sin tocar el índice ni la señal): lo reutiliza toggleTask
 * para relocalizar una tarea justo antes de reescribirla. */
export function scanTasks(path: string, content: string): TaskItem[] {
  const items: TaskItem[] = [];
  TASK_LINE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TASK_LINE_RE.exec(content))) {
    const lineStart = m.index;
    const bracketIdx = m[0].indexOf('[');
    items.push({
      path,
      idx: items.length,
      pos: lineStart,
      checkPos: lineStart + bracketIdx + 1,
      text: m[2].trim(),
      done: /x/i.test(m[1])
    });
  }
  return items;
}

export function indexTasks(path: string, content: string): void {
  tasksByNote.set(path, scanTasks(path, content));
  tasksVersion.value++;
}

export function removeTasks(path: string): void {
  if (tasksByNote.delete(path)) tasksVersion.value++;
}

export function resetTasks(): void {
  tasksByNote.clear();
  tasksVersion.value = 0;
}

/** Todas las tareas del vault, tal cual están indexadas (sin orden ni filtro). */
export function allTasks(): TaskItem[] {
  return [...tasksByNote.values()].flat();
}
