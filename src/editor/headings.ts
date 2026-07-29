import { syntaxTree } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { type EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';

export interface Heading {
  level: number;
  text: string;
  pos: number;
}

const HEADING_RE = /^ATXHeading([1-6])$/;

function extractHeadings(view: EditorView): Heading[] {
  const { state } = view;
  const doc = state.doc;
  const headings: Heading[] = [];

  // Recorremos el árbol completo (no view.visibleRanges): el índice debe
  // listar todos los encabezados de la nota, no solo los que caben en
  // pantalla en este momento.
  syntaxTree(state).iterate({
    from: 0,
    to: doc.length,
    enter(node) {
      const m = HEADING_RE.exec(node.name);
      if (!m) return;
      const level = Number(m[1]);
      const headerMark = node.node.getChild('HeaderMark');
      // Recortamos el texto tras el HeaderMark ("## ") si lo encontramos;
      // si no, un regex de respaldo cubre el mismo caso.
      const raw = headerMark
        ? doc.sliceString(headerMark.to, node.to)
        : doc.sliceString(node.from, node.to).replace(/^#{1,6}\s*/, '');
      headings.push({ level, text: raw.trim(), pos: doc.lineAt(node.from).from });
    }
  });
  return headings;
}

function sameHeadings(a: Heading[], b: Heading[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((h, i) => h.level === b[i].level && h.text === b[i].text && h.pos === b[i].pos);
}

/**
 * Extensión que extrae los encabezados (# a ######) del documento completo
 * y notifica al índice flotante cuando cambian. Se recalcula también si el
 * árbol de sintaxis cambia sin `docChanged` (parseo diferido en documentos
 * grandes que se completa en segundo plano), igual que hace live-preview.
 */
export function headingsTracker(onChange: (headings: Heading[]) => void): Extension {
  return ViewPlugin.fromClass(
    class {
      headings: Heading[];
      constructor(view: EditorView) {
        this.headings = extractHeadings(view);
        onChange(this.headings);
      }
      update(update: ViewUpdate) {
        if (!update.docChanged && syntaxTree(update.state) === syntaxTree(update.startState)) {
          return;
        }
        const next = extractHeadings(update.view);
        if (!sameHeadings(this.headings, next)) {
          this.headings = next;
          onChange(next);
        }
      }
    }
  );
}
