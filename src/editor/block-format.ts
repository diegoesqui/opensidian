import { Prec, type EditorState, type Extension } from '@codemirror/state';
import { type Command, type EditorView, type KeyBinding, keymap } from '@codemirror/view';

interface LineChange {
  from: number;
  to: number;
  insert: string;
}

type LineComputer = (lineText: string, lineFrom: number) => LineChange;

/** Aplica `compute` a cada línea tocada por la selección (una o varias), en un solo dispatch. */
function applyToLines(view: EditorView, compute: LineComputer): boolean {
  const { state } = view;
  if (state.readOnly) return false; // solo lectura (issue #32)
  const seen = new Set<number>();
  const changes: LineChange[] = [];
  for (const range of state.selection.ranges) {
    const l1 = state.doc.lineAt(range.from).number;
    const l2 = state.doc.lineAt(range.to).number;
    for (let n = l1; n <= l2; n++) {
      if (seen.has(n)) continue;
      seen.add(n);
      const line = state.doc.line(n);
      changes.push(compute(line.text, line.from));
    }
  }
  if (!changes.length) return false;
  view.dispatch({ changes });
  return true;
}

// Con flag 'd' para obtener los índices de cada grupo capturado y así tocar
// solo el carácter/hueco justo que cambia, sin reescribir la línea entera
// (lo que perdería la posición del cursor).
const LIST_RE = /^(\s*)([-*+])(\s+)(?:\[([ xX])\](\s+))?/d;
const HEADING_RE = /^(\s*)(#{1,6})(\s+)/;
const BULLET_RE = /^(\s*)([-*+])(\s+)(?:\[[ xX]\]\s+)?/;
const NUMBERED_RE = /^(\s*)(\d+)([.)])(\s+)/;

/**
 * Ciclo de 3 estados para Cmd/Ctrl+Enter (o el botón ☑): sin checkbox → tarea
 * sin marcar → tarea completada → de vuelta a sin checkbox (bullet simple).
 */
function computeChecklistChange(lineText: string, lineFrom: number): LineChange {
  const m = LIST_RE.exec(lineText) as (RegExpExecArray & { indices: Array<[number, number]> }) | null;
  if (m?.indices) {
    const checkSpan = m.indices[4];
    if (checkSpan) {
      const checked = /x/i.test(m[4]);
      if (!checked) {
        return { from: lineFrom + checkSpan[0], to: lineFrom + checkSpan[1], insert: 'x' };
      }
      const openBracket = checkSpan[0] - 1;
      const afterCheckbox = m.indices[5] ? m.indices[5][1] : checkSpan[1] + 1;
      return { from: lineFrom + openBracket, to: lineFrom + afterCheckbox, insert: '' };
    }
    const afterMarker = m.indices[3][1];
    return { from: lineFrom + afterMarker, to: lineFrom + afterMarker, insert: '[ ] ' };
  }
  return { from: lineFrom, to: lineFrom, insert: '- [ ] ' };
}

/** Nivel de heading (1-6, o 0 si no lo es) de la línea donde está el cursor. */
export function currentHeadingLevel(state: EditorState): number {
  const line = state.doc.lineAt(state.selection.main.head);
  const m = HEADING_RE.exec(line.text);
  return m ? m[2].length : 0;
}

/**
 * Fija el nivel de heading indicado; si la línea ya está en ese nivel, lo
 * quita (comportamiento de conmutador del selector H1/H2/H3).
 */
function computeSetHeading(level: number): LineComputer {
  return (lineText, lineFrom) => {
    const m = HEADING_RE.exec(lineText);
    const current = m ? m[2].length : 0;
    const target = current === level ? 0 : level;
    const to = m ? lineFrom + m[0].length : lineFrom;
    return { from: lineFrom, to, insert: target === 0 ? '' : '#'.repeat(target) + ' ' };
  };
}

/** Activa/desactiva la línea como ítem de lista con viñetas. */
function computeBulletChange(lineText: string, lineFrom: number): LineChange {
  const m = BULLET_RE.exec(lineText);
  if (m) return { from: lineFrom, to: lineFrom + m[0].length, insert: '' };
  return { from: lineFrom, to: lineFrom, insert: '- ' };
}

/** Activa/desactiva la línea como ítem de lista numerada. */
function computeNumberedChange(lineText: string, lineFrom: number): LineChange {
  const nm = NUMBERED_RE.exec(lineText);
  if (nm) return { from: lineFrom, to: lineFrom + nm[0].length, insert: '' };
  const bm = BULLET_RE.exec(lineText);
  if (bm) return { from: lineFrom, to: lineFrom + bm[0].length, insert: '1. ' };
  return { from: lineFrom, to: lineFrom, insert: '1. ' };
}

export const checklistCommand: Command = (view) => applyToLines(view, computeChecklistChange);
export const setHeadingCommand = (level: number): Command => (view) =>
  applyToLines(view, computeSetHeading(level));
export const bulletListCommand: Command = (view) => applyToLines(view, computeBulletChange);
export const numberedListCommand: Command = (view) => applyToLines(view, computeNumberedChange);

const bindings: KeyBinding[] = [{ key: 'Mod-Enter', run: checklistCommand }];

export function blockFormatKeymap(): Extension {
  // Prec.highest: @codemirror/commands ya liga Mod-Enter a "insertar línea en
  // blanco" en defaultKeymap; sin forzar prioridad, esa ganaría siempre.
  return Prec.highest(keymap.of(bindings));
}
