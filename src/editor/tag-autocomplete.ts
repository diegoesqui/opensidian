import type { CompletionContext, CompletionResult, CompletionSource } from '@codemirror/autocomplete';

/**
 * Fuente de autocompletado para #etiquetas (issue #12): al escribir "#"
 * propone etiquetas ya usadas en el vault, filtradas según se sigue
 * escribiendo. Mismo patrón que wikiLinkCompletionSource en
 * wikilink-autocomplete.ts (de ahí se copia también el porqué de exponer
 * una fuente suelta en vez de una Extension con su propio autocompletion():
 * el editor solo puede tener una).
 *
 * A diferencia de "[[", que nunca compite con nada, "#" también arranca un
 * encabezado ATX ("# Título"). No hace falta mirar el árbol de sintaxis para
 * evitar el choque: basta con no ofrecer nada mientras el cuerpo de la
 * etiqueta esté vacío (query === ''), justo el instante en que "#" podría
 * ser el principio de un encabezado. En cuanto se escribe una letra ya no
 * puede serlo (un ATX heading exige espacio tras la almohadilla), así que la
 * lista aparece a partir del segundo carácter.
 */
export function tagCompletionSource(getTagNames: () => string[]): CompletionSource {
  return (context: CompletionContext): CompletionResult | null => {
    const match = context.matchBefore(/(?<![\p{L}\p{N}_])#[\p{L}\p{N}_/-]*/u);
    if (!match) return null;
    const query = match.text.slice(1).toLowerCase();
    if (!query) return null;
    const from = match.from + 1;

    const seen = new Set<string>();
    const options = getTagNames()
      .filter((name) => {
        const key = name.toLowerCase();
        if (seen.has(key) || !key.includes(query)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => {
        const ai = a.toLowerCase().indexOf(query);
        const bi = b.toLowerCase().indexOf(query);
        return ai - bi || a.localeCompare(b);
      })
      .slice(0, 20)
      .map((label) => ({
        label,
        type: 'text',
        apply: (view: import('@codemirror/view').EditorView, _c: unknown, from2: number, to2: number) => {
          view.dispatch({
            changes: { from: from2, to: to2, insert: label },
            selection: { anchor: from2 + label.length }
          });
        }
      }));

    if (!options.length) return null;
    return { from, options, filter: false };
  };
}
