import { syntaxTree } from '@codemirror/language';
import type { Extension, Range, Text } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType
} from '@codemirror/view';
import type { SyntaxNodeRef } from '@lezer/common';
import { isRawMode, modeChanged } from './mode';

/**
 * Botón de copiar en la esquina de cada bloque ```código.
 *
 * Vive en su propio ViewPlugin y no dentro de live-preview.ts a propósito: si
 * alguna vez generase un rango inválido, CodeMirror desactiva en silencio el
 * plugin ENTERO que lo aportó, y ahí se perderían encabezados, viñetas,
 * checkboxes y enlaces de golpe. Aislado, como mucho se pierde este botón.
 *
 * Es una decoración de widget *en línea*, que sí puede venir de un ViewPlugin
 * (las de bloque no; ver la cabecera de table-preview.ts). Se ancla al inicio
 * de la línea de la valla de apertura y se coloca en la esquina con
 * `position: absolute`, así que no ocupa sitio ni altera la altura de la línea.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

type Shape = [tag: string, attrs: Record<string, string>];

// Mismo estilo que src/ui/icons.tsx (rejilla de 24, trazo, currentColor):
// nada de emojis, que los dibuja el sistema operativo y cambian de un Mac a
// un Windows.
const COPY_ICON: Shape[] = [
  ['rect', { x: '9', y: '9', width: '12', height: '12', rx: '2.5' }],
  ['path', { d: 'M6 15h-.5A2.5 2.5 0 0 1 3 12.5v-7A2.5 2.5 0 0 1 5.5 3h7A2.5 2.5 0 0 1 15 5.5V6' }]
];
const CHECK_ICON: Shape[] = [['path', { d: 'M20 6.5 9.5 17 4 11.5' }]];
const FAIL_ICON: Shape[] = [['path', { d: 'M6 6l12 12M18 6 6 18' }]];

function makeIcon(shapes: Shape[]): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  const attrs: Record<string, string> = {
    class: 'icon-svg',
    width: '14',
    height: '14',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '1.8',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true'
  };
  for (const [k, v] of Object.entries(attrs)) svg.setAttribute(k, v);
  for (const [tag, shapeAttrs] of shapes) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(shapeAttrs)) el.setAttribute(k, v);
    svg.appendChild(el);
  }
  return svg;
}

/**
 * Copia al portapapeles. La API moderna necesita contexto seguro y permiso;
 * la app se abre desde `file://` (donde sí lo es, igual que para la File
 * System Access API), pero si una política corporativa la bloquea cae al
 * método antiguo del textarea oculto en vez de fallar sin más.
 */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* sigue al plan B */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/** Devuelve el botón a su estado normal pasado un momento. */
const resetTimers = new WeakMap<HTMLElement, number>();

function flash(btn: HTMLButtonElement, ok: boolean) {
  const pending = resetTimers.get(btn);
  if (pending) clearTimeout(pending);
  btn.replaceChildren(makeIcon(ok ? CHECK_ICON : FAIL_ICON));
  btn.classList.toggle('is-copied', ok);
  btn.classList.toggle('is-failed', !ok);
  btn.title = ok ? 'Copiado' : 'No se pudo copiar';
  resetTimers.set(
    btn,
    window.setTimeout(() => {
      btn.replaceChildren(makeIcon(COPY_ICON));
      btn.classList.remove('is-copied', 'is-failed');
      btn.title = LABEL;
      resetTimers.delete(btn);
    }, 1400)
  );
}

const LABEL = 'Copiar código';

class CopyCodeWidget extends WidgetType {
  constructor(readonly code: string) {
    super();
  }

  // Mientras el contenido del bloque no cambie, CodeMirror reutiliza el DOM
  // que ya hay: el aviso de "copiado" no parpadea al escribir en otra línea.
  eq(other: CopyCodeWidget) {
    return other.code === this.code;
  }

  toDOM() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cm-copy-code';
    btn.title = LABEL;
    btn.setAttribute('aria-label', LABEL);
    btn.contentEditable = 'false';
    btn.appendChild(makeIcon(COPY_ICON));
    // El mousedown de un botón le roba el foco al editor antes de que corra su
    // onClick (misma trampa que el botón de plantillas de la barra lateral):
    // aquí además movería el cursor, así que se corta de raíz.
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      void copyToClipboard(this.code).then((ok) => flash(btn, ok));
    });
    return btn;
  }

  ignoreEvent() {
    return true;
  }
}

/**
 * Texto de dentro del bloque, sin las vallas ``` y sin la sangría con la que
 * esté escrito (un bloque dentro de una lista va indentado, y esa sangría es
 * del markdown, no del código).
 */
function fencedCodeText(doc: Text, node: SyntaxNodeRef): string {
  const first = doc.lineAt(node.from);
  const last = doc.lineAt(node.to);
  if (last.number <= first.number) return '';
  // La última línea es la valla de cierre, salvo que el bloque se haya quedado
  // sin cerrar al final del documento (mientras se escribe pasa siempre).
  const closed = /^\s*(?:```|~~~)/.test(last.text);
  const end = closed ? last.number - 1 : last.number;
  const indent = first.text.length - first.text.trimStart().length;
  const lines: string[] = [];
  for (let n = first.number + 1; n <= end; n++) {
    const text = doc.line(n).text;
    lines.push(text.slice(0, indent).trim() === '' ? text.slice(indent) : text);
  }
  return lines.join('\n');
}

function build(view: EditorView): DecorationSet {
  if (isRawMode(view.state)) return Decoration.none; // issue #32
  const ranges: Range<Decoration>[] = [];
  const doc = view.state.doc;
  // Un mismo bloque puede asomar por dos rangos visibles distintos (cuando el
  // viewport tiene un hueco), y dos widgets en la misma posición se pisarían.
  const seen = new Set<number>();

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter(node) {
        if (node.name !== 'FencedCode') return;
        const first = doc.lineAt(node.from);
        if (seen.has(first.from)) return;
        seen.add(first.from);
        const code = fencedCodeText(doc, node);
        if (!code.trim()) return; // bloque vacío: no hay nada que copiar
        ranges.push(
          Decoration.widget({ widget: new CopyCodeWidget(code), side: 1 }).range(first.from)
        );
      }
    });
  }
  return Decoration.set(ranges, true);
}

const copyCodePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        modeChanged(update) ||
        syntaxTree(update.state) !== syntaxTree(update.startState)
      ) {
        this.decorations = build(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations }
);

export function copyCodeButton(): Extension {
  return copyCodePlugin;
}
