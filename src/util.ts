import { NOTE_EXT } from './fs/vault';

export const titleOf = (path: string) => path.split('/').pop()!.replace(NOTE_EXT, '');

export const parentOf = (path: string) => {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
};

export const extOf = (name: string) => {
  const m = NOTE_EXT.exec(name);
  return m ? m[0] : '.md';
};

/** Minúsculas y sin tildes, para comparaciones de búsqueda. */
export const normalize = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const pad = (n: number) => String(n).padStart(2, '0');

/** Fecha local en formato ISO (AAAA-MM-DD). No usa `d.toISOString()` porque
 * esa pasa por UTC y desplazaría el día cerca de medianoche según la zona
 * horaria del usuario. */
export const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Construye una Date local a partir de 'AAAA-MM-DD'. `new Date(dateStr)`
 * interpretaría el string como UTC y podría mostrar el día anterior o
 * siguiente según la zona horaria; por eso se arma con los componentes. */
const parseIsoDate = (dateStr: string): Date => {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
};

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** Fecha larga en español con día de la semana: "Jueves, 31 de julio de 2026". */
export function formatDay(dateStr: string): string {
  return capitalize(
    parseIsoDate(dateStr).toLocaleDateString('es-ES', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    })
  );
}

/** Fecha legible en español sin día de la semana: "31 de julio de 2026". Es
 * el marcador {{fecha_larga}} de la plantilla del diario (issue #13); el día
 * de la semana tiene su propio marcador ({{dia_semana}}, ver weekday() más
 * abajo) porque no siempre se quieren juntos en la plantilla. */
export function longDate(dateStr: string): string {
  return parseIsoDate(dateStr).toLocaleDateString('es-ES', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
}

/** Día de la semana en español, capitalizado: "Jueves". */
export function weekday(dateStr: string): string {
  return capitalize(parseIsoDate(dateStr).toLocaleDateString('es-ES', { weekday: 'long' }));
}
