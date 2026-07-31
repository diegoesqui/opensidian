import { signal } from '@preact/signals';
import { extractTags, sameTag, type TagOccurrence } from '../tags';

/**
 * Índice de etiquetas `#etiqueta` de todas las notas, para el índice con
 * conteo de usos y el filtrado (issue #12). Mismo patrón que search/tasks.ts:
 * un Map por nota y una señal de versión que se incrementa en cada cambio,
 * para que los componentes que leen las funciones de abajo se suscriban y se
 * repinten. No recorre el vault por su cuenta: se engancha al recorrido que
 * ya hace search/index.ts al construir/actualizar su índice.
 */

const tagsByNote = new Map<string, TagOccurrence[]>();

export const tagsVersion = signal(0);

export interface TagCount {
  name: string;
  count: number;
}

export function indexTags(path: string, content: string): void {
  tagsByNote.set(path, extractTags(content));
  tagsVersion.value++;
}

export function removeTags(path: string): void {
  if (tagsByNote.delete(path)) tagsVersion.value++;
}

export function resetTags(): void {
  tagsByNote.clear();
  tagsVersion.value = 0;
}

/**
 * Etiquetas usadas en el vault con su número de usos, para el índice.
 * Agrupa por nombre ignorando mayúsculas/minúsculas (mismo criterio que
 * notesUsingTag) pero muestra la caja de la primera aparición encontrada,
 * para no imponer una normalización que el usuario no escribió.
 */
export function allTagCounts(): TagCount[] {
  const byLower = new Map<string, TagCount>();
  for (const occs of tagsByNote.values()) {
    for (const o of occs) {
      const key = o.name.toLowerCase();
      const existing = byLower.get(key);
      if (existing) existing.count++;
      else byLower.set(key, { name: o.name, count: 1 });
    }
  }
  return [...byLower.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export interface TagHit {
  path: string;
  /** Offset absoluto del `#` en la nota, para poder saltar justo ahí (ver task-jump.ts). */
  pos: number;
  line: number;
  lineText: string;
}

/** Notas y líneas que usan `tagName` (comparación ignorando mayúsculas/minúsculas). */
export function notesUsingTag(tagName: string): TagHit[] {
  const out: TagHit[] = [];
  for (const [path, occs] of tagsByNote) {
    for (const o of occs) {
      if (sameTag(o.name, tagName)) {
        out.push({ path, pos: o.start, line: o.line, lineText: o.lineText });
      }
    }
  }
  return out;
}
