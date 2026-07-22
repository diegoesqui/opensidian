import {
  acceptCompletion,
  autocompletion,
  completionKeymap,
  type CompletionContext,
  type CompletionResult
} from '@codemirror/autocomplete';
import { Prec, type Extension } from '@codemirror/state';
import { keymap } from '@codemirror/view';

/**
 * Autocompleta [[wiki-links]]: al escribir "[[" propone títulos de notas
 * existentes, filtrados según se sigue escribiendo. Tab/Enter completa con
 * "]]" y deja el cursor justo después.
 */
export function wikiLinkAutocomplete(getTitles: () => string[]): Extension {
  const source = (context: CompletionContext): CompletionResult | null => {
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

  return [
    autocompletion({ override: [source], activateOnTyping: true, icons: false }),
    // Prec.highest: Tab por defecto indenta (indentWithTab); cuando el menú
    // de autocompletar está abierto, debe aceptar la opción seleccionada.
    Prec.highest(keymap.of([{ key: 'Tab', run: acceptCompletion }, ...completionKeymap]))
  ];
}
