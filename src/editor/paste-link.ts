import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

const BARE_URL_RE = /^https?:\/\/\S+$/i;

/** Si el portapapeles trae también el HTML del enlace copiado, usa su texto visible como título. */
function labelFromHtml(html: string, url: string): string | null {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const anchor = [...doc.querySelectorAll('a[href]')].find((a) => a.getAttribute('href') === url);
    const text = anchor?.textContent?.trim();
    return text && text !== url ? text : null;
  } catch {
    return null;
  }
}

function hostnameLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * Al pegar una URL suelta (todo el contenido del portapapeles es una URL):
 * - con texto seleccionado, lo convierte en enlace hacia esa URL;
 * - sin selección, inserta un enlace markdown con el título del enlace
 *   copiado (si el portapapeles lo trae) o, si no, el dominio.
 */
export function linkPasteHandling(): Extension {
  return EditorView.domEventHandlers({
    paste(event, view) {
      const text = event.clipboardData?.getData('text/plain')?.trim();
      if (!text || !BARE_URL_RE.test(text)) return false;
      const sel = view.state.selection.main;

      if (!sel.empty) {
        const selected = view.state.sliceDoc(sel.from, sel.to);
        const insert = `[${selected}](${text})`;
        event.preventDefault();
        view.dispatch({
          changes: { from: sel.from, to: sel.to, insert },
          selection: { anchor: sel.from + insert.length }
        });
        return true;
      }

      const html = event.clipboardData?.getData('text/html');
      const label = (html && labelFromHtml(html, text)) || hostnameLabel(text);
      const insert = `[${label}](${text})`;
      event.preventDefault();
      view.dispatch({
        changes: { from: sel.from, to: sel.to, insert },
        selection: { anchor: sel.from + insert.length }
      });
      return true;
    }
  });
}
