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
}

export const NOTE_EXT = /\.(md|markdown|txt)$/i;

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
   * incluidos. */
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
