import { strToU8, zipSync } from 'fflate';
import type { Vault, VaultEntry } from './vault';

/** Descarga todas las notas del vault como un .zip (modo navegador). */
export async function exportZip(v: Vault): Promise<void> {
  const root = await v.listTree();
  const files: Record<string, Uint8Array> = {};
  const collect = async (e: VaultEntry) => {
    if (e.kind === 'file') files[e.path] = strToU8(await v.readFile(e.path));
    for (const child of e.children ?? []) await collect(child);
  };
  await collect(root);
  const zip = zipSync(files);
  const blob = new Blob([zip.slice().buffer], { type: 'application/zip' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `opensidian-${new Date().toISOString().slice(0, 10)}.zip`;
  a.click();
  URL.revokeObjectURL(a.href);
}
