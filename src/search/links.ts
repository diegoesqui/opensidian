import { signal } from '@preact/signals';
import { normalize, titleOf } from '../util';
import { extractWikiLinks, type WikiLinkOccurrence } from '../wikilink';

/**
 * Índice de enlaces del vault: para cada nota, qué wiki-links `[[...]]`
 * contiene (con su línea de contexto). Es la pieza compartida entre los
 * backlinks (issue #7) y la reescritura de enlaces al renombrar (issue #8).
 *
 * Vive junto al índice de MiniSearch (search/index.ts) porque ese módulo ya
 * recorre el contenido de todas las notas al construir/actualizar su índice;
 * así se reutiliza esa misma lectura en vez de escanear el vault dos veces.
 */

export interface Backlink {
  /** Nota de origen (la que contiene el enlace). */
  path: string;
  line: number;
  lineText: string;
}

// path -> ocurrencias de [[...]] que contiene esa nota.
const linksByNote = new Map<string, WikiLinkOccurrence[]>();

// Se incrementa en cada cambio del índice. Los componentes que dependen de
// backlinksFor() leen esta señal para suscribirse a los recálculos (no
// guardamos los backlinks ya resueltos: dependen del título de la nota
// consultada, que puede cambiar).
export const linksVersion = signal(0);

export function indexLinks(path: string, content: string): void {
  linksByNote.set(path, extractWikiLinks(content));
  linksVersion.value++;
}

export function removeLinks(path: string): void {
  if (linksByNote.delete(path)) linksVersion.value++;
}

export function resetLinks(): void {
  linksByNote.clear();
  linksVersion.value = 0;
}

/** Notas que enlazan a `targetPath`, comparando por título (no por ruta). */
export function backlinksFor(targetPath: string): Backlink[] {
  const title = normalize(titleOf(targetPath));
  const out: Backlink[] = [];
  for (const [path, occurrences] of linksByNote) {
    if (path === targetPath) continue;
    for (const o of occurrences) {
      if (normalize(o.target) === title) out.push({ path, line: o.line, lineText: o.lineText });
    }
  }
  return out;
}

/** Rutas de las notas (incluida ella misma, si se autoenlaza) que mencionan `[[oldTitle]]`. */
export function notesLinkingTo(oldTitle: string): string[] {
  const title = normalize(oldTitle);
  const paths: string[] = [];
  for (const [path, occurrences] of linksByNote) {
    if (occurrences.some((o) => normalize(o.target) === title)) paths.push(path);
  }
  return paths;
}
