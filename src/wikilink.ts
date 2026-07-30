import { normalize } from './util';

/**
 * Regex compartida para detectar wiki-links `[[Nota]]`. No son sintaxis
 * markdown estándar (no aparecen en el árbol Lezer), así que tanto el live
 * preview del editor (live-preview.ts) como el índice de enlaces del vault
 * (search/links.ts) los detectan con este mismo patrón, para no tener dos
 * definiciones que puedan divergir.
 */
export const WIKILINK_RE = /\[\[([^[\]]+)\]\]/g;

export interface WikiLinkOccurrence {
  /** Título del destino, sin alias (la parte antes de `|`, si lo hubiera). */
  target: string;
  /** Offset absoluto de inicio/fin en el texto, incluyendo los `[[` `]]`. */
  start: number;
  end: number;
  /** Línea 1-based donde aparece, y su texto completo (contexto para los backlinks). */
  line: number;
  lineText: string;
}

/** Rangos [inicio, fin) de code spans (`...`, ``...``, etc.) dentro de una línea. */
function inlineCodeSpans(line: string): Array<[number, number]> {
  const ticks: Array<{ index: number; length: number }> = [];
  const re = /`+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) ticks.push({ index: m.index, length: m[0].length });

  const spans: Array<[number, number]> = [];
  let i = 0;
  while (i < ticks.length) {
    const open = ticks[i];
    let j = i + 1;
    while (j < ticks.length && ticks[j].length !== open.length) j++;
    if (j < ticks.length) {
      spans.push([open.index, ticks[j].index + ticks[j].length]);
      i = j + 1;
    } else {
      i++;
    }
  }
  return spans;
}

/**
 * Extrae los wiki-links `[[...]]` del contenido en crudo de una nota (fuera
 * de un editor CodeMirror, así que no hay árbol Lezer disponible como en
 * live-preview.ts). Los bloques ``` y el código en línea ` se detectan aquí
 * a mano, con el mismo criterio de exclusión que aplica el editor.
 */
export function extractWikiLinks(text: string): WikiLinkOccurrence[] {
  const out: WikiLinkOccurrence[] = [];
  const lines = text.split('\n');
  let offset = 0;
  let inFence = false;
  let fenceChar = '';

  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i];
    const fenceMatch = /^\s*(```+|~~~+)/.exec(lineText);
    if (fenceMatch) {
      const char = fenceMatch[1][0];
      if (!inFence) {
        inFence = true;
        fenceChar = char;
      } else if (char === fenceChar) {
        inFence = false;
      }
    } else if (!inFence) {
      const spans = inlineCodeSpans(lineText);
      WIKILINK_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = WIKILINK_RE.exec(lineText))) {
        const start = m.index;
        const end = start + m[0].length;
        if (spans.some(([s, e]) => start >= s && end <= e)) continue;
        const inner = m[1];
        const pipe = inner.indexOf('|');
        out.push({
          target: (pipe >= 0 ? inner.slice(0, pipe) : inner).trim(),
          start: offset + start,
          end: offset + end,
          line: i + 1,
          lineText
        });
      }
    }
    offset += lineText.length + 1; // +1 por el '\n' quitado al hacer split
  }
  return out;
}

/**
 * Reescribe en `text` los `[[...]]` cuyo destino coincide (normalizado) con
 * `oldTitle`, cambiándolo por `newTitle`. Solo se toca el título dentro de
 * los corchetes -si hay alias (`[[Título|alias]]`) se conserva tal cual- y
 * nunca el resto del contenido. Devuelve null si no había nada que cambiar.
 */
export function renameWikiLinks(text: string, oldTitle: string, newTitle: string): string | null {
  const target = normalize(oldTitle);
  const matches = extractWikiLinks(text).filter((o) => normalize(o.target) === target);
  if (matches.length === 0) return null;

  let result = '';
  let last = 0;
  for (const o of matches) {
    const inner = text.slice(o.start + 2, o.end - 2);
    const pipe = inner.indexOf('|');
    const alias = pipe >= 0 ? inner.slice(pipe) : ''; // incluye el '|'
    result += text.slice(last, o.start) + '[[' + newTitle + alias + ']]';
    last = o.end;
  }
  result += text.slice(last);
  return result;
}
