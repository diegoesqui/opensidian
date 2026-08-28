import { syntaxTree } from '@codemirror/language';
import type { EditorState, Extension, Range } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view';
import type { Vault } from '../fs/vault';
import { mimeForPath } from './images';
import { isRawMode, modeChanged } from './mode';

/**
 * Render de imágenes `![](ruta)` en el live preview: fuera de la línea
 * donde está el cursor, el markdown se sustituye por un <img> real leído
 * del vault (mismo criterio `isSel` que el resto de marcadores).
 *
 * Vive en su propio ViewPlugin, separado de live-preview.ts, porque
 * necesita la instancia del Vault (que solo se conoce por nota: ver
 * markdown-editor.tsx, que la pasa como extraExtensions, igual que
 * linkClickHandling). A diferencia de las tablas (table-preview.ts), esto
 * NO hace falta un StateField: el nodo Image de @lezer/markdown es inline
 * y (salvo el caso raro con salto de línea dentro del alt text, que se
 * descarta más abajo) no cruza saltos de línea, así que un ViewPlugin sí
 * puede aportar su decoración `replace` sin que CodeMirror la rechace — la
 * prohibición (ver cabecera de table-preview.ts) es solo para decoraciones
 * de bloque o que crucen líneas.
 */

// Igual que en live-preview.ts/table-preview.ts: el widget no es
// contenteditable, así que el clic no coloca el cursor por sí solo.
function placeCursorOnClick(view: EditorView, pos: number, e: MouseEvent) {
  e.preventDefault();
  view.dispatch({ selection: { anchor: pos }, scrollIntoView: false });
  view.focus();
}

interface ImgHost extends HTMLElement {
  _revokeImageUrl?: () => void;
}

class ImageWidget extends WidgetType {
  constructor(
    readonly v: Vault,
    readonly path: string,
    readonly clickPos: number
  ) {
    super();
  }

  // Compara ruta y posición, no la instancia del Vault: así CodeMirror
  // reutiliza el <img> ya cargado (con su object URL) mientras no cambien,
  // en vez de volver a leer el archivo en cada pulsación de tecla.
  eq(other: ImageWidget) {
    return other.path === this.path && other.clickPos === this.clickPos;
  }

  toDOM(view: EditorView) {
    const wrap = document.createElement('span') as ImgHost;
    wrap.className = 'cm-image-wrap';
    wrap.addEventListener('mousedown', (e) => placeCursorOnClick(view, this.clickPos, e));

    const img = document.createElement('img');
    img.className = 'cm-image';
    img.alt = this.path;

    const markBroken = () => {
      if (wrap.classList.contains('cm-image-broken')) return;
      wrap.classList.add('cm-image-broken');
      wrap.appendChild(document.createTextNode(`Imagen no encontrada: ${this.path}`));
    };
    img.onerror = markBroken;
    // La imagen pasa de altura 0 a su tamaño real en cuanto termina de
    // cargar; sin este requestMeasure, CodeMirror sigue con la medida
    // vieja y el cursor/scroll de las líneas siguientes se descoloca.
    img.onload = () => view.requestMeasure();

    this.v
      .readBinary(this.path)
      .then((buf) => {
        const url = URL.createObjectURL(new Blob([buf], { type: mimeForPath(this.path) }));
        wrap._revokeImageUrl = () => URL.revokeObjectURL(url);
        img.src = url;
      })
      .catch(markBroken);

    wrap.appendChild(img);
    return wrap;
  }

  // Revoca el object URL al destruir el widget (p. ej. al editar la línea o
  // desmontar la nota): si no, cada re-render filtra memoria.
  destroy(dom: HTMLElement) {
    (dom as ImgHost)._revokeImageUrl?.();
  }

  ignoreEvent() {
    return true;
  }
}

function buildImageDecorations(state: EditorState, v: Vault, focused: boolean): DecorationSet {
  if (isRawMode(state)) return Decoration.none; // issue #32
  const ranges: Range<Decoration>[] = [];
  const doc = state.doc;
  const selectedIn = (from: number, to: number) =>
    focused && state.selection.ranges.some((r) => r.to >= from && r.from <= to);

  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== 'Image') return;
      const imgNode = node.node;
      const line = doc.lineAt(imgNode.from);
      // Salvaguarda: el alt text podría en teoría incluir un salto de línea
      // suave dentro del párrafo; si el nodo cruza de línea, se deja el
      // markdown en crudo en vez de arriesgar una decoración replace
      // multilínea en este ViewPlugin (ver el comentario de cabecera).
      if (doc.lineAt(imgNode.to).number !== line.number) return false;
      if (selectedIn(line.from, line.to)) return false; // se edita: se ve el markdown fuente

      const urlNode = imgNode.getChild('URL');
      if (!urlNode) return false;
      const path = doc.sliceString(urlNode.from, urlNode.to);

      ranges.push(
        Decoration.replace({ widget: new ImageWidget(v, path, imgNode.from) }).range(imgNode.from, imgNode.to)
      );
      return false;
    }
  });

  return Decoration.set(ranges, true);
}

export function imagePreview(v: Vault): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = buildImageDecorations(view.state, v, view.hasFocus);
      }
      update(update: ViewUpdate) {
        if (
          update.docChanged ||
          update.selectionSet ||
          update.focusChanged ||
          modeChanged(update) ||
          syntaxTree(update.state) !== syntaxTree(update.startState)
        ) {
          this.decorations = buildImageDecorations(update.state, v, update.view.hasFocus);
        }
      }
    },
    { decorations: (p) => p.decorations }
  );
}
