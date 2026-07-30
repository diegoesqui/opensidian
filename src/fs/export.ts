import { strToU8, zipSync } from 'fflate';
import { NOTE_EXT, type Vault } from './vault';

/** Descarga todo el vault como un .zip (modo navegador): notas y binarios (imágenes en assets/). */
export async function exportZip(v: Vault): Promise<void> {
  const paths = await v.listAllPaths();
  const files: Record<string, Uint8Array> = {};
  for (const path of paths) {
    files[path] = NOTE_EXT.test(path) ? strToU8(await v.readFile(path)) : new Uint8Array(await v.readBinary(path));
  }
  const zip = zipSync(files);
  const blob = new Blob([zip.slice().buffer], { type: 'application/zip' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `opensidian-${new Date().toISOString().slice(0, 10)}.zip`;
  a.click();
  URL.revokeObjectURL(a.href);
}
