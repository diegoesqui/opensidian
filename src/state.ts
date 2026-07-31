import { signal } from '@preact/signals';
import {
  HandleVault,
  NOTE_EXT,
  openBrowserVault,
  openFolderVault,
  TRASH_DIR,
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
import { migrateLegacyTemplate } from './templates';
import { purgeHistoryUnder, renameHistory, startHistoryTracking, stopHistoryTracking } from './history';
import { extOf, normalize, parentOf, titleOf } from './util';

export type ViewKind = 'note' | 'journal' | 'search' | 'tasks' | 'tags';

export const vault = signal<Vault | null>(null);
export const tree = signal<VaultEntry | null>(null);
export const view = signal<ViewKind>('journal');
export const currentPath = signal<string | null>(null);
export const storedVaultName = signal<string | null>(null);
export const quickOpen = signal(false);
export const vaultError = signal<string | null>(null);
/** Contenido de la papelera (issue #10), para el panel que la muestra. */
export const trashEntries = signal<VaultEntry[]>([]);

export async function refreshTree(): Promise<void> {
  const v = vault.value;
  tree.value = v ? await v.listTree() : null;
}

export async function refreshTrash(): Promise<void> {
  const v = vault.value;
  trashEntries.value = v ? await v.listTrash() : [];
}

async function activateVault(v: Vault): Promise<void> {
  vaultError.value = null;
  vault.value = v;
  currentPath.value = null;
  view.value = 'journal';
  activeTag.value = null;
  // Antes de listar el árbol o construir el índice, por si el vault trae la
  // plantilla del diario en la ruta antigua (issue #22): así entra ya
  // migrada en el primer listTree()/buildIndex(), no un instante después.
  // Nunca puede impedir que el vault se abra: es el traslado opcional de un
  // archivo heredado, y si falla (permisos, un directorio a medias) lo peor
  // que pasa es que la plantilla del diario no se aplique hasta que el
  // usuario la mueva a mano. Dejar que propague convertiría eso en «no se
  // pudo abrir la carpeta» y el usuario se quedaría sin sus notas.
  try {
    await migrateLegacyTemplate(v);
  } catch (e) {
    console.error('No se pudo migrar la plantilla del diario a templates/', e);
  }
  await refreshTree();
  void refreshTrash();
  void buildIndex(v);
  // Historial de versiones (issue #15): un barrido periódico propio, sin
  // relación con el índice de búsqueda ni con el autoguardado del editor.
  startHistoryTracking(v);
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
  activeTag.value = null;
  trashEntries.value = [];
  resetIndex();
  stopHistoryTracking();
}

export async function forgetStored(): Promise<void> {
  await clearHandle();
  storedVaultName.value = null;
}

export function openNote(path: string): void {
  currentPath.value = path;
  view.value = 'note';
}

/**
 * Etiqueta activa para filtrar (issue #12): null = el índice completo de
 * etiquetas; con valor, la vista de etiquetas muestra solo las notas y
 * líneas que la usan. Clic en una etiqueta (editor o panel) llama a esto.
 */
export const activeTag = signal<string | null>(null);

export function openTag(name: string): void {
  activeTag.value = name;
  view.value = 'tags';
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
  // En el destino hay ahora algo real: si esa ruta arrastraba una marca de
  // borrado antigua, su editor no volvería a guardar nunca. Pasa al restaurar
  // de la papelera a la raíz y arrastrar la nota de vuelta a su carpeta.
  unmarkDeleted(newPath);
  notifyRenamed(path, newPath, kind);
  // El historial de versiones (issue #15) se indexa por ruta igual que el
  // índice de búsqueda: sin esto, renombrar o mover una nota dejaría su
  // historial huérfano bajo la ruta vieja.
  await renameHistory(path, newPath, kind);
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

/**
 * Borrar (issue #10) ya no llama a deleteFile()/deleteDir(): eso pasa por
 * removeEntry() de la File System Access API, que no pasa por la papelera
 * del sistema operativo y es irreversible. Ahora se mueve a la papelera del
 * propio vault (ver moveToTrash en fs/vault.ts, que resuelve colisiones de
 * nombre) y se puede restaurar o vaciar de verdad desde el panel de la
 * papelera.
 */
export async function deleteEntry(entry: VaultEntry): Promise<void> {
  const v = vault.value;
  if (!v) return;
  await flushAll(); // que la papelera se quede con lo último editado, no con lo último guardado
  markDeleted(entry.path);
  const open = currentPath.value;
  if (open && (open === entry.path || open.startsWith(entry.path + '/'))) {
    currentPath.value = null;
  }
  const trashPath = await v.moveToTrash(entry.path, entry.kind);
  // El historial (issue #15) sigue a la nota también a la papelera: así, si
  // se restaura, reengancha con restoreEntry() de abajo sin quedar huérfano
  // bajo la ruta original (que restoreEntry ni siquiera conserva).
  await renameHistory(entry.path, trashPath, entry.kind);
  notifyDeleted(entry.path, entry.kind);
  await refreshTree();
  await refreshTrash();
}

/**
 * Restaura un elemento de la papelera a la raíz del vault (issue #10). No se
 * recuerda la carpeta original: guardarla exigiría un fichero de manifiesto
 * aparte dentro de .trash/, y para una papelera plana no compensa la
 * complejidad. Si se quiere en otro sitio, se arrastra después con el drag &
 * drop habitual de la barra lateral. Si ya hay algo con ese nombre en la
 * raíz, se avisa (vaultError) en vez de pisarlo en silencio.
 */
export async function restoreEntry(entry: VaultEntry): Promise<void> {
  const v = vault.value;
  if (!v) return;
  try {
    await v.restoreFromTrash(entry.path, entry.name);
  } catch (e) {
    vaultError.value = e instanceof Error ? e.message : String(e);
    return;
  }
  unmarkDeleted(entry.name);
  // Reengancha el historial (issue #15) que había seguido a la nota a la
  // papelera (ver deleteEntry) con su nueva ruta -la raíz, no la carpeta
  // original: restoreEntry no la recuerda, y el historial tampoco puede.
  await renameHistory(entry.path, entry.name, entry.kind);
  await refreshTree();
  await refreshTrash();
  // Reconstruye el índice entero en vez de parchear búsqueda y backlinks a
  // mano: restaurar es una acción poco frecuente, así que el coste de
  // recorrer el vault de nuevo es asumible y evita duplicar la lógica de
  // notifySaved/indexLinks para un caso que ya cubre buildIndex().
  await buildIndex(v);
}

/** Vacía la papelera para siempre (issue #10): aquí sí es un borrado real y sin vuelta atrás. */
export async function emptyTrash(): Promise<void> {
  const v = vault.value;
  if (!v) return;
  // Vaciar la papelera es un borrado real y para siempre (issue #10): su
  // historial de versiones (issue #15) tampoco debería sobrevivir, o se
  // acumularía sin límite con cada nota que el usuario tira de verdad.
  await purgeHistoryUnder(TRASH_DIR, 'dir');
  await v.emptyTrash();
  await refreshTrash();
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
