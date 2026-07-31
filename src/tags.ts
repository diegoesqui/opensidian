/**
 * Regex y extracción compartida de etiquetas `#etiqueta` (issue #12). Misma
 * idea que wikilink.ts: las etiquetas tampoco son sintaxis markdown estándar,
 * así que tanto el live preview del editor (editor/live-preview.ts) como el
 * índice del vault (search/tags.ts) las detectan con este mismo patrón, para
 * no tener dos definiciones que puedan divergir.
 *
 * Distinguir una etiqueta de un encabezado ATX (`# Título`) es más simple de
 * lo que parece: un encabezado exige un espacio (o fin de línea) justo tras
 * la almohadilla -comprobado contra el parser real de @lezer/markdown, que
 * nunca produce ATXHeading para "#pendiente" sin espacio, esté donde esté en
 * la línea-. Basta con exigir que el cuerpo de la etiqueta empiece
 * inmediatamente tras el `#` para que nunca compitan por el mismo texto. El
 * lookbehind evita además que "c#" o el segundo `#` de "##doble" cuenten
 * como inicio de etiqueta.
 */
export const TAG_RE = /(?<![\p{L}\p{N}_#])#([\p{L}\p{N}_/-]+)/gu;

// Colores hex sueltos en el texto (#ff0000, #fff, #a1b2c3d4) tienen la misma
// forma que una etiqueta. Se descartan si el cuerpo entero son solo dígitos
// hexadecimales con una de las longitudes habituales de un color.
const HEX_COLOR_RE = /^(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export function looksLikeHexColor(body: string): boolean {
  return HEX_COLOR_RE.test(body);
}

export interface TagOccurrence {
  /** Nombre de la etiqueta sin la almohadilla, con la caja (mayús/minús) original. */
  name: string;
  /** Offset absoluto de inicio/fin en el texto, incluyendo el `#`. */
  start: number;
  end: number;
  /** Línea 1-based donde aparece, y su texto completo (contexto para el panel de etiquetas). */
  line: number;
  lineText: string;
}

/**
 * Rangos [inicio, fin) de code spans (`...`, ``...``, etc.) dentro de una
 * línea. Copiado de wikilink.ts en vez de importarlo -ese archivo no lo
 * expone y no es de este issue- pero con el mismo criterio de exclusión.
 */
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
 * Extrae las etiquetas `#etiqueta` del contenido en crudo de una nota (fuera
 * de un editor CodeMirror, así que no hay árbol Lezer disponible como en
 * live-preview.ts). Los bloques ``` y el código en línea ` se detectan aquí
 * a mano, con el mismo criterio de exclusión que aplica el editor.
 */
export function extractTags(text: string): TagOccurrence[] {
  const out: TagOccurrence[] = [];
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
      TAG_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = TAG_RE.exec(lineText))) {
        const start = m.index;
        const end = start + m[0].length;
        if (spans.some(([s, e]) => start >= s && end <= e)) continue;
        if (looksLikeHexColor(m[1])) continue;
        out.push({ name: m[1], start: offset + start, end: offset + end, line: i + 1, lineText });
      }
    }
    offset += lineText.length + 1; // +1 por el '\n' quitado al hacer split
  }
  return out;
}

/** Compara dos nombres de etiqueta ignorando mayúsculas/minúsculas (misma etiqueta, distinta caja). */
export function sameTag(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}
