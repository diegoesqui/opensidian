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
const TAG_RE = /(?<![\p{L}\p{N}_#])#([\p{L}\p{N}_/-]+)/gu;

// Colores hex sueltos en el texto (#ff0000, #fff, #a1b2c3d4) tienen la misma
// forma que una etiqueta. Se descartan si el cuerpo entero son solo dígitos
// hexadecimales con una de las longitudes habituales de un color.
const HEX_COLOR_RE = /^(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

// Un cuerpo sin ninguna letra no es una etiqueta: "#12" y "#7" son la forma
// normal de citar un issue o una factura, y "#100-200" un rango de precios.
// Es la misma regla que aplica Obsidian (una etiqueta no puede ser solo
// números) y de paso descarta cuerpos degenerados como "#--" o "#/", que la
// clase de caracteres de TAG_RE admite pero nadie escribe como etiqueta.
const HAS_LETTER_RE = /\p{L}/u;

/**
 * Rangos [inicio, fin) de URLs dentro de una línea. El fragmento de una URL
 * (`https://ejemplo.com/#instalacion`) tiene exactamente la misma forma que
 * una etiqueta, y el lookbehind de TAG_RE no lo detiene porque el carácter
 * previo suele ser "/". Sin esto, pegar un enlace con ancla -algo que esta
 * app facilita, ver editor/paste-link.ts- inventaría una etiqueta que el
 * usuario no escribió y la metería en el índice.
 */
function urlSpans(line: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  const re = /(?:https?:\/\/|mailto:)\S+/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) spans.push([m.index, m.index + m[0].length]);
  return spans;
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

/** Una etiqueta encontrada en una línea, con offsets relativos a esa línea. */
export interface LineTag {
  name: string;
  start: number;
  end: number;
}

/**
 * Etiquetas de UNA línea, ya filtradas (código en línea, URLs, colores hex y
 * cuerpos sin letras). Es el único sitio donde se decide qué cuenta como
 * etiqueta: la usan tanto el índice del vault (extractTags, aquí abajo) como
 * el live preview del editor (live-preview.ts), que si no acabarían con dos
 * juegos de filtros que pueden divergir -y entonces el editor resaltaría
 * cosas que el índice no encuentra, o al revés-.
 */
export function tagsInLine(lineText: string): LineTag[] {
  const skip = [...inlineCodeSpans(lineText), ...urlSpans(lineText)];
  const out: LineTag[] = [];
  TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG_RE.exec(lineText))) {
    const start = m.index;
    const body = m[1];
    if (!HAS_LETTER_RE.test(body)) continue;
    if (HEX_COLOR_RE.test(body)) continue;
    // Basta con mirar dónde empieza: una etiqueta que arranca dentro de un
    // code span o de una URL forma parte de ellos, termine donde termine.
    if (skip.some(([s, e]) => start >= s && start < e)) continue;
    out.push({ name: body, start, end: start + m[0].length });
  }
  return out;
}

/**
 * Extrae las etiquetas `#etiqueta` del contenido en crudo de una nota (fuera
 * de un editor CodeMirror, así que no hay árbol Lezer disponible como en
 * live-preview.ts). Los bloques ``` se detectan aquí a mano; del resto de
 * filtros se encarga tagsInLine().
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
      for (const t of tagsInLine(lineText)) {
        out.push({
          name: t.name,
          start: offset + t.start,
          end: offset + t.end,
          line: i + 1,
          lineText
        });
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
