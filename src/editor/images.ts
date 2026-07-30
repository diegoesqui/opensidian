import { ASSETS_DIR, type Vault } from '../fs/vault';

export { ASSETS_DIR };

const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp'
};

const EXT_TO_MIME: Record<string, string> = Object.fromEntries(
  Object.entries(MIME_TO_EXT).map(([mime, ext]) => [ext, mime])
);

/** Extensión de archivo a partir del tipo MIME del portapapeles; 'png' si no se reconoce. */
export function extForMime(mime: string): string {
  return MIME_TO_EXT[mime] ?? 'png';
}

/** Tipo MIME a partir de la extensión de la ruta, para que el <img> la reconozca al mostrarla. */
export function mimeForPath(path: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return EXT_TO_MIME[ext] ?? 'application/octet-stream';
}

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/**
 * Genera una ruta estable (fecha/hora) dentro de assets/ y comprueba que no
 * colisione con un archivo existente (p. ej. dos pegados en el mismo
 * segundo), añadiendo un sufijo numérico en ese caso.
 */
export async function uniqueAssetPath(v: Vault, ext: string): Promise<string> {
  const base = `${ASSETS_DIR}/imagen-${timestamp()}`;
  let path = `${base}.${ext}`;
  let i = 2;
  while (await v.exists(path)) {
    path = `${base}-${i}.${ext}`;
    i++;
  }
  return path;
}

const IMAGE_NAME_RE = /\.(png|jpe?g|gif|webp|svg|bmp)$/i;

/** true si el archivo es una imagen soportada, por tipo MIME o, en su defecto, por extensión. */
export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/') || IMAGE_NAME_RE.test(file.name);
}
