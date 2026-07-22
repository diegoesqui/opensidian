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
