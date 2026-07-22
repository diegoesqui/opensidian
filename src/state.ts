import { signal } from '@preact/signals';
import {
  HandleVault,
  NOTE_EXT,
  openBrowserVault,
  openFolderVault,
  type Vault,
  type VaultEntry
} from './fs/vault';
import { clearHandle, loadHandle, storeHandle } from './fs/handle-store';
import { flushAll, markDeleted, unmarkDeleted } from './editor/autosave';
import { buildIndex, notifyDeleted, notifyRenamed, notifySaved, resetIndex } from './search';
import { seedDemoVault } from './fs/demo';
import { extOf, parentOf, titleOf } from './util';

export type ViewKind = 'note' | 'journal' | 'search';

export const vault = signal<Vault | null>(null);
export const tree = signal<VaultEntry | null>(null);
export const view = signal<ViewKind>('journal');
export const currentPath = signal<string | null>(null);
export const storedVaultName = signal<string | null>(null);
export const quickOpen = signal(false);
export const vaultError = signal<string | null>(null);

export async function refreshTree(): Promise<void> {
  const v = vault.value;
  tree.value = v ? await v.listTree() : null;
}

async function activateVault(v: Vault): Promise<void> {
  vaultError.value = null;
  vault.value = v;
  currentPath.value = null;
  view.value = 'journal';
  await refreshTree();
  void buildIndex(v);
}

export async function pickFolder(): Promise<void> {
  vaultError.value = null;
  try {
    const v = await openFolderVault();
    await storeHandle(v.root);
    storedVaultName.value = v.name;
    await activateVault(v);
  } catch (e) {
    if ((e as DOMException)?.name !== 'AbortError') {
      vaultError.value = `No se pudo abrir la carpeta: ${String(e)}`;
    }
  }
}

export async function reopenStored(interactive: boolean): Promise<boolean> {
  try {
    const handle = await loadHandle();
    if (!handle) return false;
    storedVaultName.value = handle.name;
    let perm = await handle.queryPermission({ mode: 'readwrite' });
    if (perm === 'prompt' && interactive) {
      perm = await handle.requestPermission({ mode: 'readwrite' });
    }
    if (perm !== 'granted') return false;
    await activateVault(new HandleVault(handle, handle.name, 'fsa'));
    return true;
  } catch (e) {
    vaultError.value = `No se pudo reabrir la carpeta: ${String(e)}`;
    return false;
  }
}

export async function useBrowserVault(): Promise<void> {
  await activateVault(await openBrowserVault());
}

/** Vuelve a la pantalla de inicio (no borra nada). */
export async function switchVault(): Promise<void> {
  await flushAll();
  vault.value = null;
  tree.value = null;
  currentPath.value = null;
  resetIndex();
}

export async function forgetStored(): Promise<void> {
  await clearHandle();
  storedVaultName.value = null;
}

export function openNote(path: string): void {
  currentPath.value = path;
  view.value = 'note';
}

const sanitizeName = (name: string) => name.replace(/[\\/:*?"<>|]/g, '-').trim();

async function freePath(v: Vault, dirPath: string, name: string): Promise<string> {
  const ext = extOf(name);
  const base = name.slice(0, -ext.length);
  for (let i = 1; ; i++) {
    const candidate = i === 1 ? name : `${base} ${i}${ext}`;
    const path = dirPath ? `${dirPath}/${candidate}` : candidate;
    if (!(await v.exists(path))) return path;
  }
}

export async function createNote(dirPath: string, rawName: string): Promise<string | null> {
  const v = vault.value;
  if (!v) return null;
  let name = sanitizeName(rawName) || 'Sin título';
  if (!NOTE_EXT.test(name)) name += '.md';
  const path = await freePath(v, dirPath, name);
  unmarkDeleted(path);
  await v.writeFile(path, '');
  notifySaved(path, '');
  await refreshTree();
  openNote(path);
  return path;
}

export async function createFolder(dirPath: string, rawName: string): Promise<void> {
  const v = vault.value;
  if (!v) return;
  const name = sanitizeName(rawName);
  if (!name) return;
  await v.createDir(dirPath ? `${dirPath}/${name}` : name);
  await refreshTree();
}

async function renamePath(
  path: string,
  kind: 'file' | 'dir',
  currentName: string,
  rawName: string
): Promise<void> {
  const v = vault.value;
  if (!v) return;
  let name = sanitizeName(rawName);
  if (!name || name === currentName) return;
  if (kind === 'file' && !NOTE_EXT.test(name)) name += extOf(currentName);
  const parent = parentOf(path);
  const newPath = parent ? `${parent}/${name}` : name;
  if (await v.exists(newPath)) {
    vaultError.value = `Ya existe «${name}».`;
    return;
  }
  await flushAll();
  await v.rename(path, newPath);
  const open = currentPath.value;
  if (open === path) currentPath.value = newPath;
  else if (open && kind === 'dir' && open.startsWith(path + '/')) {
    currentPath.value = newPath + open.slice(path.length);
  }
  notifyRenamed(path, newPath, kind);
  await refreshTree();
}

export async function renameEntry(entry: VaultEntry, rawName: string): Promise<void> {
  await renamePath(entry.path, entry.kind, entry.name, rawName);
}

/** Renombra la nota que se está viendo, a partir del título editado en NoteView. */
export async function renameNoteTitle(path: string, rawTitle: string): Promise<void> {
  await renamePath(path, 'file', titleOf(path), rawTitle);
}

export async function deleteEntry(entry: VaultEntry): Promise<void> {
  const v = vault.value;
  if (!v) return;
  markDeleted(entry.path);
  if (entry.kind === 'file') await v.deleteFile(entry.path);
  else await v.deleteDir(entry.path);
  const open = currentPath.value;
  if (open && (open === entry.path || open.startsWith(entry.path + '/'))) {
    currentPath.value = null;
  }
  notifyDeleted(entry.path, entry.kind);
  await refreshTree();
}

export async function initApp(): Promise<void> {
  const params = new URLSearchParams(location.search);
  if (params.has('demo')) {
    const v = await openBrowserVault();
    await seedDemoVault(v);
    await activateVault(v);
    return;
  }
  // Reapertura silenciosa si el permiso sigue concedido; si no, la pantalla
  // de inicio mostrará el botón «Reabrir …».
  await reopenStored(false);
}
