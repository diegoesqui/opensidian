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
import { flushAll, markDeleted, notifyExternalChange, unmarkDeleted } from './editor/autosave';
import {
  buildIndex,
  filePaths,
  notifyDeleted,
  notifyRenamed,
  notifySaved,
  resetIndex,
  rewriteLinksTo
} from './search';
import { seedDemoVault } from './fs/demo';
import { extOf, normalize, parentOf, titleOf } from './util';

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

/** Cmd/Ctrl+clic en un enlace [[Nota]]: la abre si existe, o la crea en la raíz. */
export async function openOrCreateWikiLink(title: string): Promise<void> {
  const target = normalize(title);
  if (!target) return;
  const match = filePaths.value.find((p) => normalize(titleOf(p)) === target);
  if (match) {
    openNote(match);
    return;
  }
  await createNote('', title);
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

/**
 * Reescribe (issue #8) los `[[Título antiguo]]` de las demás notas -y de la
 * propia, si se autoenlazaba- a `[[Título nuevo]]`, cuando el título de una
 * nota cambia de verdad (no al moverla de carpeta: ahí el nombre de archivo,
 * y por tanto el título, no cambia).
 *
 * flushAll() ya se llamó antes de tocar el disco (ver movePath), así que el
 * índice de contenidos refleja lo último guardado, incluida cualquier nota
 * que estuviera abierta con cambios pendientes. Tras escribir cada nota
 * afectada se avisa con notifySaved (para que el índice de búsqueda/enlaces
 * no quede desactualizado) y con notifyExternalChange (para que, si esa nota
 * está abierta en el editor ahora mismo, se recargue sin esperar a un
 * foco/desenfoque de la ventana -si no, su próximo autoguardado
 * sobrescribiría la reescritura con el contenido antiguo que aún tiene en
 * memoria-).
 */
async function updateLinksAfterRename(v: Vault, oldTitle: string, newTitle: string): Promise<void> {
  for (const { path, content } of rewriteLinksTo(oldTitle, newTitle)) {
    try {
      await v.writeFile(path, content);
      notifySaved(path, content);
      await notifyExternalChange(path);
    } catch (e) {
      console.error('No se pudieron actualizar los enlaces en', path, e);
    }
  }
}

/** Primitiva común a renombrar y mover: reubica path -> newPath. */
async function movePath(path: string, kind: 'file' | 'dir', newPath: string): Promise<boolean> {
  const v = vault.value;
  if (!v || newPath === path) return false;
  if (await v.exists(newPath)) {
    vaultError.value = `Ya existe «${newPath.split('/').pop()}» en ese destino.`;
    return false;
  }
  await flushAll();
  // El título solo cambia si es un archivo Y su nombre (sin extensión)
  // cambia; mover de carpeta conserva el nombre, así que ahí no hace falta
  // reescribir nada.
  const oldTitle = kind === 'file' ? titleOf(path) : null;
  const newTitle = kind === 'file' ? titleOf(newPath) : null;
  await v.rename(path, newPath);
  const open = currentPath.value;
  if (open === path) currentPath.value = newPath;
  else if (open && kind === 'dir' && open.startsWith(path + '/')) {
    currentPath.value = newPath + open.slice(path.length);
  }
  notifyRenamed(path, newPath, kind);
  if (oldTitle !== null && newTitle !== null && oldTitle !== newTitle) {
    await updateLinksAfterRename(v, oldTitle, newTitle);
  }
  await refreshTree();
  return true;
}

async function renamePath(
  path: string,
  kind: 'file' | 'dir',
  currentName: string,
  rawName: string
): Promise<void> {
  let name = sanitizeName(rawName);
  if (!name || name === currentName) return;
  if (kind === 'file' && !NOTE_EXT.test(name)) name += extOf(currentName);
  const parent = parentOf(path);
  const newPath = parent ? `${parent}/${name}` : name;
  await movePath(path, kind, newPath);
}

export async function renameEntry(entry: VaultEntry, rawName: string): Promise<void> {
  await renamePath(entry.path, entry.kind, entry.name, rawName);
}

/** Renombra la nota que se está viendo, a partir del título editado en NoteView. */
export async function renameNoteTitle(path: string, rawTitle: string): Promise<void> {
  await renamePath(path, 'file', titleOf(path), rawTitle);
}

/** Mueve una nota o carpeta a otra carpeta destino (drag & drop en la barra lateral). */
export async function moveEntry(entry: VaultEntry, destDir: string): Promise<void> {
  if (parentOf(entry.path) === destDir) return; // ya está ahí
  if (entry.kind === 'dir' && (destDir === entry.path || destDir.startsWith(entry.path + '/'))) {
    vaultError.value = 'No puedes mover una carpeta dentro de sí misma.';
    return;
  }
  const newPath = destDir ? `${destDir}/${entry.name}` : entry.name;
  await movePath(entry.path, entry.kind, newPath);
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
