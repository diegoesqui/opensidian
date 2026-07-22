type FlushFn = () => Promise<void> | void;

const flushers = new Set<FlushFn>();
const deletedPaths = new Set<string>();

export function registerFlusher(fn: FlushFn): () => void {
  flushers.add(fn);
  return () => flushers.delete(fn);
}

/** Guarda inmediatamente todo lo que tenga cambios pendientes. */
export async function flushAll(): Promise<void> {
  await Promise.allSettled([...flushers].map((fn) => fn()));
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
