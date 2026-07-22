import { get, set, del } from 'idb-keyval';

const KEY = 'opensidian.vaultHandle';

export const storeHandle = (handle: FileSystemDirectoryHandle) => set(KEY, handle);
export const loadHandle = () => get<FileSystemDirectoryHandle>(KEY);
export const clearHandle = () => del(KEY);
