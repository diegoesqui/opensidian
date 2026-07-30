import MiniSearch from 'minisearch';
import { signal } from '@preact/signals';
import type { Vault, VaultEntry } from '../fs/vault';
import { normalize, titleOf } from '../util';
import { renameWikiLinks } from '../wikilink';
import { indexLinks, notesLinkingTo, removeLinks, resetLinks } from './links';
import { indexTasks, removeTasks, resetTasks } from './tasks';

export { backlinksFor, linksVersion } from './links';

export interface NoteHit {
  path: string;
  title: string;
  snippet: string;
}

interface Doc {
  path: string;
  title: string;
  content: string;
}

const contents = new Map<string, string>();
let mini = createMini();

export const indexReady = signal(false);
export const filePaths = signal<string[]>([]);

function createMini() {
  return new MiniSearch<Doc>({
    idField: 'path',
    fields: ['title', 'content'],
    storeFields: ['title'],
    searchOptions: {
      boost: { title: 3 },
      prefix: true,
      fuzzy: 0.1,
      combineWith: 'AND'
    }
  });
}

function docFor(path: string, content: string): Doc {
  return { path, title: titleOf(path), content };
}

export function resetIndex() {
  mini = createMini();
  contents.clear();
  filePaths.value = [];
  indexReady.value = false;
  resetLinks();
  resetTasks();
}

export async function buildIndex(v: Vault): Promise<void> {
  resetIndex();
  const root = await v.listTree();
  const files: string[] = [];
  const collect = (e: VaultEntry) => {
    if (e.kind === 'file') files.push(e.path);
    e.children?.forEach(collect);
  };
  collect(root);
  for (const path of files) {
    try {
      const content = await v.readFile(path);
      contents.set(path, content);
      mini.add(docFor(path, content));
      indexLinks(path, content);
      indexTasks(path, content);
    } catch {
      // archivo ilegible: se omite del índice
    }
  }
  filePaths.value = [...contents.keys()].sort();
  indexReady.value = true;
}

export function notifySaved(path: string, content: string) {
  const existed = contents.has(path);
  contents.set(path, content);
  if (existed) {
    try {
      mini.discard(path);
    } catch {
      // ya no estaba en el índice
    }
  } else {
    filePaths.value = [...filePaths.value, path].sort();
  }
  mini.add(docFor(path, content));
  indexLinks(path, content);
  indexTasks(path, content);
}

export function notifyDeleted(path: string, kind: 'file' | 'dir') {
  const gone = (p: string) => p === path || (kind === 'dir' && p.startsWith(path + '/'));
  for (const p of [...contents.keys()]) {
    if (!gone(p)) continue;
    contents.delete(p);
    try {
      mini.discard(p);
    } catch {
      // no estaba en el índice
    }
    removeLinks(p);
    removeTasks(p);
  }
  filePaths.value = filePaths.value.filter((p) => !gone(p));
}

export function notifyRenamed(oldPath: string, newPath: string, kind: 'file' | 'dir') {
  const moved: Array<[string, string]> = [];
  for (const p of contents.keys()) {
    if (kind === 'file' ? p === oldPath : p === oldPath || p.startsWith(oldPath + '/')) {
      moved.push([p, newPath + p.slice(oldPath.length)]);
    }
  }
  for (const [from, to] of moved) {
    const content = contents.get(from)!;
    notifyDeleted(from, 'file');
    contents.set(to, content);
    mini.add(docFor(to, content));
    indexLinks(to, content);
    indexTasks(to, content);
  }
  filePaths.value = [...contents.keys()].sort();
}

/**
 * Para el renombrado (issue #8): notas cuyo contenido menciona `[[oldTitle]]`
 * junto con ese texto ya reescrito a `[[newTitle]]`. No escribe en el vault
 * ni actualiza el índice -eso es responsabilidad de quien la llama, que sabe
 * cómo persistir el cambio y avisar a los editores abiertos-.
 */
export function rewriteLinksTo(
  oldTitle: string,
  newTitle: string
): Array<{ path: string; content: string }> {
  const out: Array<{ path: string; content: string }> = [];
  for (const path of notesLinkingTo(oldTitle)) {
    const content = contents.get(path);
    if (content === undefined) continue;
    const rewritten = renameWikiLinks(content, oldTitle, newTitle);
    if (rewritten !== null) out.push({ path, content: rewritten });
  }
  return out;
}

/** Búsqueda full-text con snippet alrededor de la primera coincidencia. */
export function searchNotes(query: string): NoteHit[] {
  if (!query.trim()) return [];
  const results = mini.search(query).slice(0, 50);
  const firstTerm = normalize(query.trim().split(/\s+/)[0]);
  return results.map((r) => {
    const path = r.id as string;
    const content = contents.get(path) ?? '';
    const idx = normalize(content).indexOf(firstTerm);
    let snippet = '';
    if (idx >= 0) {
      const start = Math.max(0, idx - 50);
      const end = Math.min(content.length, idx + 110);
      snippet =
        (start > 0 ? '…' : '') +
        content.slice(start, end).replace(/\s+/g, ' ').trim() +
        (end < content.length ? '…' : '');
    } else {
      snippet = content.slice(0, 140).replace(/\s+/g, ' ').trim();
    }
    return { path, title: (r as unknown as { title: string }).title ?? titleOf(path), snippet };
  });
}

/** Filtro rápido por nombre para el quick switcher. */
export function quickMatch(query: string, limit = 12): string[] {
  const q = normalize(query.trim());
  const paths = filePaths.value;
  if (!q) return paths.slice(0, limit);
  const scored: Array<[number, string]> = [];
  for (const path of paths) {
    const title = normalize(titleOf(path));
    const full = normalize(path);
    let score = -1;
    if (title.startsWith(q)) score = 0;
    else if (title.includes(q)) score = 1;
    else if (full.includes(q)) score = 2;
    if (score >= 0) scored.push([score, path]);
  }
  scored.sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1]));
  return scored.slice(0, limit).map(([, p]) => p);
}
