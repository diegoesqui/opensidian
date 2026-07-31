import {
  acceptCompletion,
  completionKeymap,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource
} from '@codemirror/autocomplete';
import { Prec, type Extension } from '@codemirror/state';
import { keymap } from '@codemirror/view';

/**
 * Tab/Enter acepta la opción seleccionada del menú de autocompletar
 * (Prec.highest: si no, Tab por defecto indenta -indentWithTab-). Se expone
 * suelta porque markdown-editor.tsx la comparte entre esta fuente y la de
 * tag-autocomplete.ts: ver el porqué en el comentario de
 * wikiLinkCompletionSource más abajo.
 */
export const acceptCompletionKeymap: Extension = Prec.highest(
  keymap.of([{ key: 'Tab', run: acceptCompletion }, ...completionKeymap])
);

/**
 * Fuente de autocompletado para [[wiki-links]]: al escribir "[[" propone
 * títulos de notas existentes, filtrados según se sigue escribiendo.
 * Tab/Enter completa con "]]" y deja el cursor justo después.
 *
 * Se expone como fuente suelta (CompletionSource) en vez de devolver ya la
 * Extension con su propio autocompletion() montado, porque el editor
 * necesita además tagCompletionSource (tag-autocomplete.ts) en la MISMA
 * instancia de CodeMirror, y @codemirror/autocomplete no admite dos
 * extensiones autocompletion() independientes activas a la vez: su config
 * `override` no tiene combinador y CodeMirror lanza "Config merge conflict
 * for field override" en cuanto hay dos valores distintos. Quien monta el
 * editor (markdown-editor.tsx) combina esta fuente y la de etiquetas en una
 * única llamada a autocompletion().
 */
export function wikiLinkCompletionSource(getTitles: () => string[]): CompletionSource {
  return (context: CompletionContext): CompletionResult | null => {
    const match = context.matchBefore(/\[\[[^[\]\n]*/);
    if (!match) return null;
    const query = match.text.slice(2).toLowerCase();
    const from = match.from + 2;

    const seen = new Set<string>();
    const options = getTitles()
      .filter((title) => {
        const key = title.toLowerCase();
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
          const after = view.state.sliceDoc(to2, to2 + 2);
          const to = after === ']]' ? to2 + 2 : to2;
          const insert = `${label}]]`;
          view.dispatch({
            changes: { from: from2, to, insert },
            selection: { anchor: from2 + insert.length }
          });
        }
      }));

    if (!options.length) return null;
    return { from, options, filter: false };
  };
}
