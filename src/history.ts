import { createStore, del, delMany, get, keys, set, update } from 'idb-keyval';
import { strFromU8, strToU8, unzlibSync, zlibSync } from 'fflate';
import { flushAll, notifyExternalChange, unmarkDeleted } from './editor/autosave';
import { indexedContents, indexReady, notifySaved } from './search';
import type { Vault } from './fs/vault';

/**
 * Historial local de versiones por nota (issue #15). Vive en IndexedDB, vía
 * idb-keyval, en un almacén propio -no el mismo que usa fs/handle-store.ts
 * para el handle del vault- para no mezclar un dato minúsculo (el handle) con
 * lo que aquí puede crecer bastante más: así, si algún día hace falta
 * inspeccionar o vaciar el historial a mano, es una base de datos aparte.
 *
 * IMPORTANTE, y hay que dejarlo clarísimo en la interfaz (ver
 * ui/history-panel.tsx): esto NO es una copia de seguridad. Vive en el
 * navegador, no en el vault -no viaja si el vault se copia a otro equipo- y
 * desaparece si se borra el perfil de Chrome. Es solo la red de seguridad
 * para "se borró un párrafo por accidente y el autoguardado ya lo escribió".
 */
const store = createStore('opensidian-historial', 'versiones');

interface StoredVersion {
  ts: number;
  /** Contenido comprimido con fflate (zlib): las notas son texto, comprimen
   * bien, y con decenas de versiones por nota el ahorro de espacio compensa
   * de sobra el coste (trivial) de deflate/inflate en un texto de pocos KB. */
  data: Uint8Array;
}

export interface HistoryVersion {
  ts: number;
  content: string;
}

/** Cada cuánto se repasan las notas en busca de contenido que haya
 * cambiado desde la última instantánea (issue #15). 5 minutos: bastante fino
 * como para no perder gran cosa de una sesión de edición si algo sale mal,
 * pero muy por debajo de la frecuencia del autoguardado (500 ms) y en un
 * temporizador aparte, para no competir nunca con él por E/S ni CPU mientras
 * se escribe. */
const SCAN_INTERVAL_MS = 5 * 60 * 1000;

/** Tope duro de versiones guardadas por nota. A 5 min de intervalo, una
 * sesión de escritura sin pausas llenaría esto en menos de dos horas; a
 * partir de ahí se descartan las más viejas (ver prune()). El número es
 * arbitrario pero acotado a propósito: notas de texto comprimidas pesan muy
 * poco, así que 20 versiones por nota es un coste de disco irrelevante
 * incluso con un vault de varios cientos de notas. */
const MAX_VERSIONS = 20;

/** Además del tope anterior, cualquier versión de más de 14 días se
 * descarta -salvo que sea la única que queda para esa nota-. Pasado ese
 * plazo esto ya no protege "una sesión de trabajo salió mal", sino que
 * empieza a acumularse sin más, justo lo que pide evitar el issue #15 ("no
 * puede crecer sin límite y llenar la cuota del navegador"). */
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

/** Notas más grandes que esto no se versionan. Es la excepción, no la regla:
 * evita que un archivo atípicamente enorme (un volcado pegado por error, p.
 * ej.) dispare una compresión cara en cada barrido por una nota que
 * probablemente nadie va a querer "restaurar" línea a línea de todos modos. */
const MAX_SNAPSHOT_CHARS = 2 * 1024 * 1024;

function compress(content: string): Uint8Array {
  return zlibSync(strToU8(content));
}

function decompress(data: Uint8Array): string {
  return strFromU8(unzlibSync(data));
}

/** Últimos contenidos vistos por nota, para no tener que descomprimir la
 * última versión guardada en cada barrido solo para compararla. Se reinicia
 * al abrir un vault (startHistoryTracking): no persiste entre sesiones, así
 * que el primer barrido de cada sesión la repuebla leyendo de IndexedDB (ver
 * tick()) en vez de asumir "no está en caché = cambió", que generaría una
 * versión duplicada de cada nota sin tocar nada más abrir la app. */
let lastContent = new Map<string, string>();

function prune(versions: StoredVersion[]): StoredVersion[] {
  const sorted = [...versions].sort((a, b) => a.ts - b.ts);
  const cutoff = Date.now() - MAX_AGE_MS;
  // Descarta las versiones más viejas que MAX_AGE_MS, pero conserva siempre
  // la última: una nota que lleva semanas sin tocarse no debería quedarse sin
  // ningún historial solo por eso.
  const kept = sorted.filter((v, i) => v.ts >= cutoff || i === sorted.length - 1);
  return kept.slice(-MAX_VERSIONS);
}

async function appendVersion(path: string, content: string, ts = Date.now()): Promise<void> {
  if (content.length > MAX_SNAPSHOT_CHARS) return;
  const data = compress(content);
  await update<StoredVersion[] | undefined>(path, (old) => prune([...(old ?? []), { ts, data }]), store);
  lastContent.set(path, content);
}

/** Versiones guardadas de una nota, más recientes primero. */
export async function getVersions(path: string): Promise<HistoryVersion[]> {
  const stored = (await get<StoredVersion[]>(path, store)) ?? [];
  return stored
    .map((v) => ({ ts: v.ts, content: decompress(v.data) }))
    .sort((a, b) => b.ts - a.ts);
}

function runWhenIdle(fn: () => void): void {
  const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void })
    .requestIdleCallback;
  if (typeof ric === 'function') ric(fn, { timeout: 2000 });
  else setTimeout(fn, 0);
}

let timer: ReturnType<typeof setInterval> | null = null;
let scanning = false;

/**
 * Un barrido: compara cada nota con su última instantánea y guarda las que
 * hayan cambiado.
 *
 * El contenido sale del índice de búsqueda (indexedContents), que ya lo
 * mantiene en memoria al día, y NO de leer el vault entero del disco cada
 * vez: ese es el patrón del proyecto para cualquier índice que se cuelgue de
 * search/index.ts, y aquí evita además una ronda de lecturas cada 5 minutos
 * durante toda la sesión -algo que se nota en un portátil con la carpeta de
 * notas en un disco gestionado o de red-.
 *
 * Consecuencia asumida: una edición hecha FUERA de la app (abrir el .md con
 * otro editor) no genera instantánea, porque el índice tampoco se entera
 * hasta que se recarga. No se pierde nada del historial ya guardado, solo se
 * deja de añadir fotos de lo que la app no ve; y hoy ninguna otra parte de
 * Opensidian detecta esos cambios externos tampoco.
 */
async function tick(): Promise<void> {
  if (scanning) return;
  // Con el índice a medio construir, contents solo tiene una parte de las
  // notas: esperar al siguiente barrido en vez de guardar fotos a medias.
  if (!indexReady.value) return;
  scanning = true;
  try {
    // Que "el contenido actual" sea de verdad el último, no lo que quedó a
    // medio escribir hace menos de 500 ms. flushAll() dispara el guardado
    // pendiente, que a su vez pasa por notifySaved y deja contents al día.
    await flushAll();
    for (const [path, content] of [...indexedContents()]) {
      let known = lastContent.get(path);
      if (known === undefined) {
        const stored = await get<StoredVersion[]>(path, store);
        known = stored?.length ? decompress(stored[stored.length - 1].data) : undefined;
      }
      if (known !== content) {
        await appendVersion(path, content);
      } else {
        lastContent.set(path, content);
      }
    }
  } finally {
    scanning = false;
  }
}

/** Arranca el barrido periódico para el vault recién activado. Se llama
 * desde activateVault() en state.ts; el temporizador vive mientras ese vault
 * esté abierto y se para en switchVault(). No recibe el vault: el contenido
 * lo pone el índice de búsqueda (ver tick()), y así tampoco puede quedarse
 * un barrido en vuelo apuntando al vault anterior tras cambiar de carpeta. */
export function startHistoryTracking(): void {
  stopHistoryTracking();
  lastContent = new Map();
  timer = setInterval(() => runWhenIdle(() => void tick()), SCAN_INTERVAL_MS);
}

export function stopHistoryTracking(): void {
  if (timer !== null) clearInterval(timer);
  timer = null;
}

async function keysMatching(path: string, kind: 'file' | 'dir'): Promise<string[]> {
  const all = (await keys(store)) as string[];
  return all.filter((k) => (kind === 'file' ? k === path : k === path || k.startsWith(path + '/')));
}

/**
 * Traslada el historial de `oldPath` a `newPath` (issue #15: al renombrar o
 * mover una nota cambia su ruta, y el historial se indexa por ruta). Se
 * llama tanto para renombrados/movimientos reales (movePath en state.ts)
 * como -con los mismos dos argumentos- cuando una nota entra o sale de la
 * papelera (deleteEntry/restoreEntry), reutilizando esta única función: para
 * el historial, "la nota pasó a vivir en .trash/…" no es distinto de
 * cualquier otro cambio de ruta.
 */
export async function renameHistory(oldPath: string, newPath: string, kind: 'file' | 'dir'): Promise<void> {
  if (oldPath === newPath) return;
  const matches = await keysMatching(oldPath, kind);
  for (const k of matches) {
    const value = await get(k, store);
    if (value === undefined) continue;
    const newKey = newPath + k.slice(oldPath.length);
    await set(newKey, value, store);
    await del(k, store);
    if (lastContent.has(k)) {
      lastContent.set(newKey, lastContent.get(k)!);
      lastContent.delete(k);
    }
  }
}

/** Borra para siempre el historial de todo lo que cuelgue de `path` (issue
 * #15: al vaciar la papelera de verdad, su historial tampoco debería quedar
 * huérfano acumulándose sin límite). */
export async function purgeHistoryUnder(path: string, kind: 'file' | 'dir'): Promise<void> {
  const matches = await keysMatching(path, kind);
  if (matches.length) await delMany(matches, store);
  for (const k of matches) lastContent.delete(k);
}

/**
 * Restaura una versión guardada como contenido actual de la nota. Además de
 * escribirlo en el vault:
 * - unmarkDeleted(): CRÍTICO (ver autosave.ts) — al restaurar vuelve a haber
 *   algo real en `path`; si arrastraba una marca de borrado, su editor
 *   dejaría de guardar en silencio para siempre.
 * - notifySaved(): si no, el índice de búsqueda/enlaces/tareas/etiquetas se
 *   queda con el contenido anterior.
 * - notifyExternalChange(): si la nota está abierta ahora mismo (NoteView o
 *   el diario), que recargue ya — si no, su próximo autoguardado (500 ms)
 *   sobrescribiría la restauración con lo que aún tuviera en memoria.
 * - Y por último, registra el propio restaurar como una versión nueva: así
 *   el historial también sirve para deshacer una restauración equivocada.
 */
export async function restoreVersion(v: Vault, path: string, version: HistoryVersion): Promise<void> {
  unmarkDeleted(path);
  await v.writeFile(path, version.content);
  notifySaved(path, version.content);
  await notifyExternalChange(path);
  await appendVersion(path, version.content);
}
