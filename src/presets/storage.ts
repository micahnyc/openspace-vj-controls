/**
 * Autosave (localStorage) and .json save/load. In Chrome, Save overwrites the
 * file that was loaded (File System Access API); elsewhere it downloads.
 */
import type { MappingFile } from './schema';

const AUTOSAVE_KEY = 'osvj.autosave.v1';

export function readAutosave(): unknown {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

export function writeAutosave(file: MappingFile): boolean {
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(file));
    return true;
  } catch {
    return false;
  }
}

// Minimal File System Access API types (not in lib.dom yet).
interface FsWritable {
  write(data: string): Promise<void>;
  close(): Promise<void>;
}
export interface FsFileHandle {
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<FsWritable>;
}
interface PickerOptions {
  suggestedName?: string;
  types?: { description: string; accept: Record<string, string[]> }[];
}
interface FsWindow {
  showOpenFilePicker?: (o?: PickerOptions & { multiple?: boolean }) => Promise<FsFileHandle[]>;
  showSaveFilePicker?: (o?: PickerOptions) => Promise<FsFileHandle>;
}

const TYPES = [{ description: 'Mapping file', accept: { 'application/json': ['.json'] } }];

export const canOverwrite = typeof window !== 'undefined' && 'showSaveFilePicker' in window;

export function fileNameFor(file: MappingFile): string {
  const slug = file.name.trim().replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'mappings';
  return `${slug}.json`;
}

/** Pick and read a .json file. Returns null if the user cancels. */
export async function openFile(): Promise<{ text: string; name: string; handle: FsFileHandle | null } | null> {
  const w = window as unknown as FsWindow;
  if (w.showOpenFilePicker) {
    try {
      const [handle] = await w.showOpenFilePicker({ types: TYPES, multiple: false });
      if (!handle) return null;
      const f = await handle.getFile();
      return { text: await f.text(), name: f.name, handle };
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return null;
      throw e;
    }
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
      const f = input.files?.[0];
      resolve(f ? { text: await f.text(), name: f.name, handle: null } : null);
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

/**
 * Save. With a handle, overwrite it; with saveAs or no handle, ask where
 * (Chrome) or download a copy. Returns the handle to reuse, or null if cancelled.
 */
export async function saveFile(
  file: MappingFile,
  handle: FsFileHandle | null,
  saveAs: boolean,
): Promise<{ handle: FsFileHandle | null; name: string } | null> {
  const text = JSON.stringify(file, null, 2) + '\n';
  const w = window as unknown as FsWindow;
  let target = saveAs ? null : handle;
  if (!target && w.showSaveFilePicker) {
    try {
      target = await w.showSaveFilePicker({ suggestedName: fileNameFor(file), types: TYPES });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return null;
      throw e;
    }
  }
  if (target) {
    const out = await target.createWritable();
    await out.write(text);
    await out.close();
    return { handle: target, name: target.name };
  }
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileNameFor(file);
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { handle: null, name: a.download };
}
