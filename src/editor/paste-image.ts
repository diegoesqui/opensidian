import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { Vault } from '../fs/vault';
import { extForMime, isImageFile, uniqueAssetPath } from './images';

/** Busca el primer archivo de imagen en un DataTransfer (portapapeles o arrastre). */
function imageFileFrom(data: DataTransfer | null): File | null {
  if (!data) return null;
  for (const file of Array.from(data.files)) {
    if (isImageFile(file)) return file;
  }
  return null;
}

async function insertImage(
  view: EditorView,
  v: Vault,
  file: File,
  pos: number,
  onError: (message: string) => void
): Promise<void> {
  let path: string;
  try {
    path = await uniqueAssetPath(v, extForMime(file.type));
    await v.writeBinary(path, file);
  } catch (e) {
    // Vault sin cuota (típico en OPFS) o error de escritura: se avisa en la
    // interfaz en vez de perder la imagen en silencio.
    onError(`No se pudo guardar la imagen: ${String(e)}`);
    return;
  }
  const insert = `![](${path})`;
  view.dispatch({
    changes: { from: pos, to: pos, insert },
    selection: { anchor: pos + insert.length }
  });
}

/**
 * Pegar (Ctrl/Cmd+V) o arrastrar un archivo de imagen sobre el editor: se
 * guarda en assets/ dentro del vault y se inserta el enlace markdown en la
 * posición del cursor (paste) o de la soltada (drop).
 *
 * Coordina con linkPasteHandling (paste-link.ts): esa extensión, al ver que
 * el portapapeles trae una imagen, se retira sin actuar (ver el guard al
 * principio de su manejador de paste) para que esta gane siempre que haya
 * una imagen, aunque el portapapeles también incluya texto de una URL (p.
 * ej. "copiar imagen" en un navegador suele copiar ambas cosas a la vez).
 */
export function imagePasteHandling(v: Vault, onError: (message: string) => void): Extension {
  return EditorView.domEventHandlers({
    paste(event, view) {
      const file = imageFileFrom(event.clipboardData);
      if (!file) return false;
      event.preventDefault();
      void insertImage(view, v, file, view.state.selection.main.from, onError);
      return true;
    },
    // Sin cancelar dragover, el navegador no dispara "drop" sobre el área
    // editable (o aplica su propio manejo nativo de arrastrar-y-soltar).
    dragover(event) {
      if (!event.dataTransfer?.types.includes('Files')) return false;
      event.preventDefault();
      return true;
    },
    drop(event, view) {
      const file = imageFileFrom(event.dataTransfer);
      if (!file) return false;
      event.preventDefault();
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.from;
      void insertImage(view, v, file, pos, onError);
      return true;
    }
  });
}
