type FlushFn = () => Promise<void> | void;
type ReloadFn = () => Promise<void> | void;

const flushers = new Set<FlushFn>();
const deletedPaths = new Set<string>();
const reloaders = new Map<string, ReloadFn>();

export function registerFlusher(fn: FlushFn): () => void {
  flushers.add(fn);
  return () => flushers.delete(fn);
}

/** Guarda inmediatamente todo lo que tenga cambios pendientes. */
export async function flushAll(): Promise<void> {
  await Promise.allSettled([...flushers].map((fn) => fn()));
}

// Se indexa por ruta porque la vista de diario monta varios editores a la vez
// (uno por día), así que no vale una única referencia global.
export function registerReloader(path: string, fn: ReloadFn): () => void {
  reloaders.set(path, fn);
  return () => {
    if (reloaders.get(path) === fn) reloaders.delete(path);
  };
}

/**
 * Avisa de que `path` cambió en disco por una operación ajena al propio
 * editor (p. ej. la reescritura de enlaces al renombrar otra nota). Si esa
 * nota está abierta ahora mismo, se recarga sin esperar a un foco/desenfoque
 * de la ventana -si no, el próximo autoguardado de ese editor sobrescribiría
 * el cambio con el contenido antiguo que aún tiene en memoria-.
 */
export async function notifyExternalChange(path: string): Promise<void> {
  await reloaders.get(path)?.();
}

// Un editor abierto sobre una nota recién borrada no debe "resucitarla"
// al hacer flush en su desmontaje.
export function markDeleted(path: string) {
  deletedPaths.add(path);
}

export function unmarkDeleted(path: string) {
  deletedPaths.delete(path);
}

export function isDeleted(path: string): boolean {
  for (const d of deletedPaths) {
    if (path === d || path.startsWith(d + '/')) return true;
  }
  return false;
}

export function initAutosaveHooks() {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushAll();
  });
  window.addEventListener('beforeunload', () => {
    void flushAll();
  });
}
