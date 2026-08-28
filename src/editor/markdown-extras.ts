import type { InlineContext, MarkdownConfig } from '@lezer/markdown';
import { Tag, tags } from '@lezer/highlight';

/**
 * Sintaxis markdown que el parser no trae de serie (issue #31), añadida como
 * extensiones de @lezer/markdown.
 *
 * No hay dependencia nueva: `markdown()` acepta un array de `MarkdownConfig`
 * y el parser ya está en el bundle. Se hace aquí, en el parser, y no con una
 * pasada de regex por línea (como los wiki-links y las etiquetas, ver
 * live-preview.ts) porque estas dos SÍ son sintaxis en línea de markdown:
 * pasando por el árbol quedan automáticamente fuera del código en línea y de
 * los bloques ```, respetan los escapes con "\" y las ve también el
 * renderizador de impresión (print-render.ts), que recorre el mismo árbol.
 *
 * Lo que ya venía y solo faltaba pintar (superíndices `^x^`, subíndices `~x~`)
 * no está aquí: @codemirror/lang-markdown los activa por defecto en su
 * `markdownLanguage`, así que solo hacía falta decorarlos (live-preview.ts).
 */

// Misma tabla de puntuación que usa @lezer/markdown para decidir si un
// delimitador puede abrir o cerrar (reglas de "flanking" de CommonMark).
const Punctuation = /[!\"#$%&'()*+,\-.\/:;<=>?@\[\\\]^_`{|}~\xA1‐-‧]/;

/**
 * Etiqueta de resaltado para `==texto==`. Hace falta una propia: es un formato
 * que no existe en CommonMark ni en GFM, así que `@lezer/highlight` no trae
 * ningún tag equivalente al que engancharla (ver el HighlightStyle de
 * editor.ts, donde se le da la clase `.cm-highlight`).
 */
export const highlightTag = Tag.define();

const HighlightDelim = { resolve: 'Highlight', mark: 'HighlightMark' };

/**
 * `==texto resaltado==`, como en Obsidian. Calcado del `Strikethrough` de
 * @lezer/markdown (mismo par de delimitadores de dos caracteres, mismas
 * reglas de apertura/cierre), cambiando `~~` por `==`.
 */
export const Highlight: MarkdownConfig = {
  defineNodes: [
    { name: 'Highlight', style: { 'Highlight/...': highlightTag } },
    { name: 'HighlightMark', style: tags.processingInstruction }
  ],
  parseInline: [
    {
      name: 'Highlight',
      parse(cx: InlineContext, next: number, pos: number) {
        // Exactamente dos "=": ni uno (que aparece suelto en cualquier
        // fórmula o comparación) ni tres o más.
        if (next != 61 /* '=' */ || cx.char(pos + 1) != 61 || cx.char(pos + 2) == 61) return -1;
        const before = cx.slice(pos - 1, pos);
        const after = cx.slice(pos + 2, pos + 3);
        const sBefore = /\s|^$/.test(before);
        const sAfter = /\s|^$/.test(after);
        const pBefore = Punctuation.test(before);
        const pAfter = Punctuation.test(after);
        return cx.addDelimiter(
          HighlightDelim,
          pos,
          pos + 2,
          !sAfter && (!pAfter || sBefore || pBefore),
          !sBefore && (!pBefore || sAfter || pAfter)
        );
      },
      after: 'Emphasis'
    }
  ]
};

/**
 * Referencias a notas al pie: `[^1]`, `[^nota-larga]`. Cubre tanto la llamada
 * dentro del texto como la etiqueta de la línea de definición (`[^1]: …`), que
 * es el mismo nodo al principio de línea y seguido de dos puntos; quien las
 * distingue para pintarlas distinto es live-preview.ts.
 *
 * Se instala ANTES del parser de enlaces por dos motivos:
 *
 *  - `[^1]` es, para CommonMark, un enlace de referencia sin resolver: el
 *    parser lo envuelve en un nodo `Link` sin URL que el live preview
 *    descarta, así que la nota al pie se veía tal cual en el texto.
 *  - `^` es el delimitador de superíndice (`Superscript`, activo por defecto),
 *    y dos referencias pegadas -"[^1][^2]"- hacían que el tramo "^1][^" casara
 *    como superíndice. Consumiendo la referencia entera aquí, ese texto ya no
 *    llega al parser de superíndices.
 *
 * La etiqueta no admite espacios ni corchetes, igual que en Pandoc y Obsidian:
 * así "[^ ...]" o un corchete abierto sin cerrar no se comen media línea.
 */
export const Footnote: MarkdownConfig = {
  defineNodes: [
    { name: 'FootnoteRef' },
    { name: 'FootnoteMark', style: tags.processingInstruction }
  ],
  parseInline: [
    {
      name: 'FootnoteRef',
      parse(cx: InlineContext, next: number, pos: number) {
        if (next != 91 /* '[' */ || cx.char(pos + 1) != 94 /* '^' */) return -1;
        for (let i = pos + 2; i < cx.end; i++) {
          const ch = cx.char(i);
          if (ch == 93 /* ']' */) {
            if (i == pos + 2) return -1; // "[^]": etiqueta vacía
            return cx.addElement(
              cx.elt('FootnoteRef', pos, i + 1, [
                cx.elt('FootnoteMark', pos, pos + 2),
                cx.elt('FootnoteMark', i, i + 1)
              ])
            );
          }
          // Un espacio o un corchete de apertura significan que esto no era
          // una referencia; se deja para el resto de parsers.
          if (ch == 91 /* '[' */ || ch == 32 || ch == 9 || ch == 10) return -1;
        }
        return -1;
      },
      before: 'Link'
    }
  ]
};

export const markdownExtras: MarkdownConfig[] = [Highlight, Footnote];
