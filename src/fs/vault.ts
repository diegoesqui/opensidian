export interface VaultEntry {
  name: string;
  path: string; // relativo a la raíz del vault, separado por '/'; '' para la raíz
  kind: 'file' | 'dir';
  children?: VaultEntry[];
}

export interface Vault {
  name: string;
  kind: 'fsa' | 'opfs';
  listTree(): Promise<VaultEntry>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  readBinary(path: string): Promise<ArrayBuffer>;
  writeBinary(path: string, data: Blob | ArrayBuffer): Promise<void>;
  /** Todas las rutas de archivo, notas y binarios (para exportar); listTree() solo lista notas. */
  listAllPaths(): Promise<string[]>;
  deleteFile(path: string): Promise<void>;
  deleteDir(path: string): Promise<void>;
  createDir(path: string): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  lastModified(path: string): Promise<number | null>;
  /** Mueve path a la papelera (issue #10), resolviendo colisiones de nombre;
   * devuelve la ruta final dentro de TRASH_DIR. */
  moveToTrash(path: string, kind: 'file' | 'dir'): Promise<string>;
  /** Contenido de primer nivel de la papelera, tal cual está en disco (sin
   * filtrar por extensión: puede haber notas o carpetas con cualquier cosa
   * dentro). */
  listTrash(): Promise<VaultEntry[]>;
  /** Restaura un elemento de la papelera a destPath. Lanza si destPath ya
   * existe: restaurar nunca pisa nada en silencio. */
  restoreFromTrash(trashPath: string, destPath: string): Promise<void>;
  /** Borrado real y definitivo de todo el contenido de la papelera. */
  emptyTrash(): Promise<void>;
}

export const NOTE_EXT = /\.(md|markdown|txt)$/i;

/**
 * Carpeta del vault donde se guardan las imágenes pegadas o arrastradas.
 * Vive aquí, en la capa del vault, porque es parte de su disposición en
 * disco: `listTree()` la oculta del árbol de notas y quien escriba en ella
 * (editor/images.ts) importa el nombre desde aquí, no al revés.
 */
export const ASSETS_DIR = 'assets';

/**
 * Carpeta de plantillas del vault (issue #13, ampliada en el #22): las
 * plantillas son notas normales dentro de esta carpeta -sin punto delante, a
 * propósito-, así que aparecen en el árbol, en la búsqueda y en el Ctrl/⌘K
 * como cualquier otra nota, y se crean, renombran, mueven y borran con los
 * mismos gestos de la barra lateral que el resto del vault. No hay ningún
 * filtro que las oculte: el árbol sigue siendo un reflejo exacto de lo que
 * hay en disco.
 */
export const TEMPLATES_DIR = 'templates';

/**
 * Papelera del vault (issue #10): borrar mueve aquí en vez de llamar a
 * removeEntry() directamente, que no pasa por la papelera del sistema
 * operativo y es irreversible. El nombre empieza por '.' a propósito: tanto
 * listTree() como listAllPaths() ya saltan cualquier entrada que empiece por
 * '.', así que la papelera queda oculta del árbol de notas y de la
 * exportación a zip sin añadir un filtro nuevo (ver comentario en
 * listAllPaths sobre por qué esto último es una decisión, no un efecto
 * colateral).
 */
export const TRASH_DIR = '.trash';

function iterate(dir: FileSystemDirectoryHandle): AsyncIterable<FileSystemHandle> {
  return (dir as unknown as { values(): AsyncIterable<FileSystemHandle> }).values();
}

export class HandleVault implements Vault {
  constructor(
    readonly root: FileSystemDirectoryHandle,
    public name: string,
    public kind: 'fsa' | 'opfs'
  ) {}

  private split(path: string): [string, string] {
    const i = path.lastIndexOf('/');
    return i === -1 ? ['', path] : [path.slice(0, i), path.slice(i + 1)];
  }

  private async dirFor(path: string, create = false): Promise<FileSystemDirectoryHandle> {
    let dir = this.root;
    if (!path) return dir;
    for (const part of path.split('/')) {
      dir = await dir.getDirectoryHandle(part, { create });
    }
    return dir;
  }

  private async fileFor(path: string, create = false): Promise<FileSystemFileHandle> {
    const [parent, name] = this.split(path);
    const dir = await this.dirFor(parent, create);
    return dir.getFileHandle(name, { create });
  }

  async listTree(): Promise<VaultEntry> {
    const walk = async (dir: FileSystemDirectoryHandle, path: string): Promise<VaultEntry> => {
      const children: VaultEntry[] = [];
      for await (const handle of iterate(dir)) {
        if (handle.name.startsWith('.')) continue;
        // La carpeta de imágenes es almacenamiento interno, no notas: en el
        // árbol se vería siempre vacía (solo se listan archivos con
        // NOTE_EXT) y solo estorbaría. listAllPaths() sí la incluye, que es
        // lo que hace que los binarios entren en la exportación a zip.
        if (!path && handle.kind === 'directory' && handle.name === ASSETS_DIR) continue;
        const childPath = path ? `${path}/${handle.name}` : handle.name;
        if (handle.kind === 'directory') {
          children.push(await walk(handle as FileSystemDirectoryHandle, childPath));
        } else if (NOTE_EXT.test(handle.name)) {
          children.push({ name: handle.name, path: childPath, kind: 'file' });
        }
      }
      children.sort((a, b) =>
        a.kind !== b.kind
          ? a.kind === 'dir' ? -1 : 1
          : a.name.localeCompare(b.name, 'es', { sensitivity: 'base', numeric: true })
      );
      return { name: dir.name, path, kind: 'dir', children };
    };
    return walk(this.root, '');
  }

  async readFile(path: string): Promise<string> {
    const handle = await this.fileFor(path);
    return (await handle.getFile()).text();
  }

  async writeFile(path: string, content: string): Promise<void> {
    const handle = await this.fileFor(path, true);
    const writable = await handle.createWritable();
    await writable.write(content);
    await writable.close();
  }

  async readBinary(path: string): Promise<ArrayBuffer> {
    const handle = await this.fileFor(path);
    return (await handle.getFile()).arrayBuffer();
  }

  async writeBinary(path: string, data: Blob | ArrayBuffer): Promise<void> {
    const handle = await this.fileFor(path, true);
    const writable = await handle.createWritable();
    // createWritable().write() no acepta ArrayBuffer suelto en todos los
    // motores; se envuelve en Blob para que ambos backends (FSA y OPFS,
    // que comparten esta misma clase) lo acepten por igual.
    await writable.write(data instanceof Blob ? data : new Blob([data]));
    await writable.close();
  }

  /** Todas las rutas de archivo del vault, sin filtrar por extensión: a
   * diferencia de listTree() (que solo lista notas, para la barra lateral y
   * la búsqueda), esta se usa para exportar el vault completo, binarios
   * incluidos.
   *
   * Decisión (issue #10): la papelera (TRASH_DIR) NO entra en el zip
   * exportado. El filtro de '.' de aquí abajo ya la excluye porque su nombre
   * empieza por punto, pero es intencional y no un efecto colateral: exportar
   * es "llévate una copia de mis notas", y las notas que están en la papelera
   * son justo las que el usuario decidió quitar de en medio -incluirlas
   * resucitaría en el zip algo que se pidió borrar, y además podría traer
   * duplicados con sufijo raro (p. ej. "Nota 2.md") fruto de colisiones al
   * borrar-. Si se quiere conservar una nota borrada, la vía es restaurarla
   * primero (panel de la papelera) y exportar después. */
  async listAllPaths(): Promise<string[]> {
    const paths: string[] = [];
    const walk = async (dir: FileSystemDirectoryHandle, path: string): Promise<void> => {
      for await (const handle of iterate(dir)) {
        if (handle.name.startsWith('.')) continue;
        const childPath = path ? `${path}/${handle.name}` : handle.name;
        if (handle.kind === 'directory') await walk(handle as FileSystemDirectoryHandle, childPath);
        else paths.push(childPath);
      }
    };
    await walk(this.root, '');
    return paths;
  }

  async exists(path: string): Promise<boolean> {
    try {
      await this.fileFor(path);
      return true;
    } catch {
      try {
        await this.dirFor(path);
        return true;
      } catch {
        return false;
      }
    }
  }

  async lastModified(path: string): Promise<number | null> {
    try {
      const handle = await this.fileFor(path);
      return (await handle.getFile()).lastModified;
    } catch {
      return null;
    }
  }

  async deleteFile(path: string): Promise<void> {
    const [parent, name] = this.split(path);
    const dir = await this.dirFor(parent);
    await dir.removeEntry(name);
  }

  async deleteDir(path: string): Promise<void> {
    const [parent, name] = this.split(path);
    const dir = await this.dirFor(parent);
    await dir.removeEntry(name, { recursive: true });
  }

  async createDir(path: string): Promise<void> {
    await this.dirFor(path, true);
  }

  private async copyDirInto(src: FileSystemDirectoryHandle, destPath: string): Promise<void> {
    await this.createDir(destPath);
    for await (const handle of iterate(src)) {
      const childDest = `${destPath}/${handle.name}`;
      if (handle.kind === 'directory') {
        await this.copyDirInto(handle as FileSystemDirectoryHandle, childDest);
      } else {
        const file = await (handle as FileSystemFileHandle).getFile();
        const target = await this.fileFor(childDest, true);
        const writable = await target.createWritable();
        await writable.write(await file.arrayBuffer());
        await writable.close();
      }
    }
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    let isFile = true;
    try {
      await this.fileFor(oldPath);
    } catch {
      isFile = false;
    }
    if (isFile) {
      await this.writeFile(newPath, await this.readFile(oldPath));
      await this.deleteFile(oldPath);
    } else {
      await this.copyDirInto(await this.dirFor(oldPath), newPath);
      await this.deleteDir(oldPath);
    }
  }

  /** Igual que freePath() en state.ts pero sin asumir que todo es una nota:
   * esa función usa extOf(), que para algo sin extensión de nota devuelve
   * '.md' por defecto (pensado para crear notas), y aquí también entran
   * carpetas, a las que ese '.md' de más les quedaría mal. */
  private async freeNameIn(dirPath: string, name: string, kind: 'file' | 'dir'): Promise<string> {
    const dot = kind === 'file' ? name.lastIndexOf('.') : -1;
    const base = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    for (let i = 1; ; i++) {
      const candidate = i === 1 ? name : `${base} ${i}${ext}`;
      const path = dirPath ? `${dirPath}/${candidate}` : candidate;
      if (!(await this.exists(path))) return path;
    }
  }

  async moveToTrash(path: string, kind: 'file' | 'dir'): Promise<string> {
    // Borrar algo que ya está en la papelera no tiene ruta de UI (listTree()
    // la oculta del árbol, así que nada puede seleccionarla para "Eliminar"),
    // pero por si se llama directamente es un no-op: no tiene sentido una
    // papelera dentro de la papelera.
    if (path === TRASH_DIR || path.startsWith(`${TRASH_DIR}/`)) return path;
    await this.dirFor(TRASH_DIR, true);
    const [, name] = this.split(path);
    const trashPath = await this.freeNameIn(TRASH_DIR, name, kind);
    await this.rename(path, trashPath);
    return trashPath;
  }

  async listTrash(): Promise<VaultEntry[]> {
    let dir: FileSystemDirectoryHandle;
    try {
      dir = await this.dirFor(TRASH_DIR);
    } catch {
      return []; // la papelera aún no existe: está vacía
    }
    const out: VaultEntry[] = [];
    for await (const handle of iterate(dir)) {
      out.push({
        name: handle.name,
        path: `${TRASH_DIR}/${handle.name}`,
        kind: handle.kind === 'directory' ? 'dir' : 'file'
      });
    }
    out.sort((a, b) =>
      a.kind !== b.kind
        ? a.kind === 'dir' ? -1 : 1
        : a.name.localeCompare(b.name, 'es', { sensitivity: 'base', numeric: true })
    );
    return out;
  }

  async restoreFromTrash(trashPath: string, destPath: string): Promise<void> {
    if (await this.exists(destPath)) {
      throw new Error(`Ya existe «${destPath.split('/').pop()}» en el destino.`);
    }
    await this.rename(trashPath, destPath);
  }

  async emptyTrash(): Promise<void> {
    try {
      await this.deleteDir(TRASH_DIR);
    } catch {
      // no existía: nada que vaciar
    }
  }
}

export const supportsFolders = (): boolean => 'showDirectoryPicker' in window;

export async function openFolderVault(): Promise<HandleVault> {
  const handle = await window.showDirectoryPicker({ id: 'opensidian-vault', mode: 'readwrite' });
  return new HandleVault(handle, handle.name, 'fsa');
}

export async function openBrowserVault(): Promise<HandleVault> {
  const root = await navigator.storage.getDirectory();
  return new HandleVault(root, 'Notas en este navegador', 'opfs');
}
