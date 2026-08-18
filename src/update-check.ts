import { signal } from '@preact/signals';

/**
 * Aviso de versión nueva.
 *
 * La app no puede actualizarse sola, y no es una limitación que se pueda
 * sortear: el host que sirve los archivos de las releases de GitHub no manda
 * cabeceras CORS, así que un `fetch()` de la nueva versión se bloquea; y el
 * navegador nunca revela en qué ruta del disco está la página, así que aunque
 * se tuviera el archivo no habría forma de escribir encima de sí misma. Lo
 * único que sí se puede hacer -y es donde está el valor- es enterarse de que
 * hay una versión nueva y ofrecer el enlace para bajarla a mano.
 *
 * La API de GitHub sí manda `access-control-allow-origin: *`, de modo que esta
 * consulta funciona incluso con la app abierta por doble clic (origen `null`).
 */

const REPO = 'diegoesqui/opensidian';
const API = `https://api.github.com/repos/${REPO}/releases/latest`;

/** Una consulta al día basta: no es información que cambie por horas. */
const INTERVALO_MS = 24 * 60 * 60 * 1000;
const CLAVE = 'opensidian:update-check';
/** Si GitHub no contesta pronto, se abandona: esto nunca debe estorbar. */
const TIMEOUT_MS = 5000;

export interface UpdateInfo {
  version: string;
  url: string;
}

/** Versión nueva disponible, o null si no la hay (o aún no se sabe). */
export const updateAvailable = signal<UpdateInfo | null>(null);

interface Cache {
  comprobadoEn: number;
  ultima: UpdateInfo | null;
}

function leerCache(): Cache | null {
  try {
    const raw = localStorage.getItem(CLAVE);
    if (!raw) return null;
    const c = JSON.parse(raw) as Cache;
    return typeof c?.comprobadoEn === 'number' ? c : null;
  } catch {
    return null;
  }
}

function guardarCache(c: Cache): void {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(c));
  } catch {
    // localStorage lleno o bloqueado por política: se comprobará otra vez.
  }
}

/**
 * Compara dos versiones `x.y.z`. Devuelve true si `a` es posterior a `b`.
 * Compara número a número, no como texto: "0.10.0" es posterior a "0.9.0",
 * pero alfabéticamente iría antes.
 */
export function esPosterior(a: string, b: string): boolean {
  const partes = (v: string) => v.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const [x, y] = [partes(a), partes(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const da = x[i] ?? 0;
    const db = y[i] ?? 0;
    if (da !== db) return da > db;
  }
  return false;
}

/**
 * Consulta la última release y publica el aviso si es más nueva que esta copia.
 *
 * Falla en silencio ante cualquier problema -sin red, GitHub bloqueado por la
 * política de la empresa, límite de peticiones, respuesta rara-: enterarse de
 * que hay una actualización es un extra, y nunca debe traducirse en un error
 * en pantalla ni en un arranque más lento.
 */
export async function checkForUpdate(): Promise<void> {
  const cache = leerCache();
  const ahora = Date.now();

  if (cache && ahora - cache.comprobadoEn < INTERVALO_MS) {
    // Aún vale lo consultado la última vez; se reaprovecha para no repetir la
    // petición en cada apertura del archivo.
    if (cache.ultima && esPosterior(cache.ultima.version, __APP_VERSION__)) {
      updateAvailable.value = cache.ultima;
    }
    return;
  }

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const res = await fetch(API, {
      signal: ctrl.signal,
      headers: { Accept: 'application/vnd.github+json' }
    });
    clearTimeout(timer);
    if (!res.ok) return;

    const data = (await res.json()) as { tag_name?: string; html_url?: string };
    if (!data.tag_name || !data.html_url) return;

    const ultima: UpdateInfo = {
      version: data.tag_name.replace(/^v/, ''),
      url: data.html_url
    };
    guardarCache({ comprobadoEn: ahora, ultima });
    if (esPosterior(ultima.version, __APP_VERSION__)) updateAvailable.value = ultima;
  } catch {
    // Silencio deliberado: ver el comentario de la función.
  }
}

/**
 * Lanza la comprobación cuando el navegador esté ocioso, para no competir con
 * el arranque (abrir el vault e indexar las notas van primero).
 */
export function initUpdateCheck(): void {
  const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void })
    .requestIdleCallback;
  const lanzar = () => void checkForUpdate();
  if (ric) ric(lanzar, { timeout: 10_000 });
  else setTimeout(lanzar, 3000);
}
