import type { SavedPotteryItem } from '../types.ts';

const STORAGE_KEY = 'clay_hands_gallery_v1';

export interface StorageResult<T = void> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function getDefaultStorage(): StorageLike | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

export function isValidSavedPotteryItem(raw: unknown): raw is SavedPotteryItem {
  if (!raw || typeof raw !== 'object') return false;
  const item = raw as Partial<SavedPotteryItem>;
  if (
    typeof item.id !== 'string' ||
    typeof item.name !== 'string' ||
    typeof item.createdAt !== 'string' ||
    typeof item.glazeId !== 'string' ||
    !item.measurements ||
    !item.profile
  ) {
    return false;
  }
  if (
    item.paintDataUrl !== undefined &&
    typeof item.paintDataUrl !== 'string'
  ) {
    return false;
  }
  if (item.kind === 'name') {
    const nd = item.nameData;
    if (
      !nd ||
      typeof nd !== 'object' ||
      typeof nd.text !== 'string' ||
      typeof nd.plaqueShape !== 'string' ||
      typeof nd.letterRelief !== 'number' ||
      typeof nd.letterBoldness !== 'number' ||
      !Array.isArray(nd.sculptDeltas)
    ) {
      return false;
    }
  }
  const p = item.profile;
  return (
    Array.isArray(p.outerRadii) &&
    Array.isArray(p.innerRadii) &&
    Array.isArray(p.heights) &&
    p.outerRadii.length >= 8 &&
    p.outerRadii.length === p.heights.length &&
    p.innerRadii.length === p.outerRadii.length &&
    typeof p.openDepth === 'number' &&
    p.outerRadii.every((n) => typeof n === 'number' && Number.isFinite(n))
  );
}

export class PotteryStorage {
  private readonly storage: StorageLike | null;

  constructor(storage?: StorageLike | null) {
    this.storage = storage === undefined ? getDefaultStorage() : storage;
  }

  public loadAll(): StorageResult<SavedPotteryItem[]> {
    if (!this.storage) {
      return {
        ok: false,
        data: [],
        error: 'Local storage is unavailable in this browser context.',
      };
    }
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) return { ok: true, data: [] };

      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return {
          ok: false,
          data: [],
          error: 'Saved pottery gallery data was corrupted and could not be read.',
        };
      }

      const validItems = parsed.filter(isValidSavedPotteryItem);
      const hadInvalid = validItems.length !== parsed.length;
      return {
        ok: !hadInvalid,
        data: validItems,
        error: hadInvalid
          ? 'Some corrupted gallery entries were skipped.'
          : undefined,
      };
    } catch {
      return {
        ok: false,
        data: [],
        error: 'Could not parse saved pottery gallery data.',
      };
    }
  }

  public saveItem(item: SavedPotteryItem): StorageResult<SavedPotteryItem[]> {
    if (!this.storage) {
      return {
        ok: false,
        error: 'Local storage is unavailable; could not save creation.',
      };
    }
    if (!isValidSavedPotteryItem(item)) {
      return {
        ok: false,
        error: 'Invalid pottery profile data; save aborted.',
      };
    }

    const current = this.loadAll();
    const existing = current.data ?? [];
    const next = [item, ...existing.filter((x) => x.id !== item.id)];

    return this.writeAll(next, item.id);
  }

  public renameItem(
    id: string,
    newName: string
  ): StorageResult<SavedPotteryItem[]> {
    const trimmed = newName.trim();
    if (!trimmed) {
      return { ok: false, error: 'Name cannot be empty.' };
    }
    const current = this.loadAll();
    const list = current.data ?? [];
    const found = list.some((x) => x.id === id);
    if (!found) {
      return { ok: false, error: 'Creation not found.' };
    }
    const next = list.map((x) => (x.id === id ? { ...x, name: trimmed } : x));
    return this.writeAll(next);
  }

  public deleteItem(id: string): StorageResult<SavedPotteryItem[]> {
    const current = this.loadAll();
    const next = (current.data ?? []).filter((x) => x.id !== id);
    return this.writeAll(next);
  }

  private writeAll(
    items: SavedPotteryItem[],
    verifyId?: string
  ): StorageResult<SavedPotteryItem[]> {
    if (!this.storage) {
      return { ok: false, error: 'Local storage is unavailable.' };
    }
    try {
      const payload = JSON.stringify(items);
      this.storage.setItem(STORAGE_KEY, payload);
      // Verify readback to never falsely claim save succeeded
      const readback = this.storage.getItem(STORAGE_KEY);
      if (!readback) {
        return {
          ok: false,
          error: 'Browser did not persist gallery data.',
        };
      }
      if (verifyId) {
        const parsed = JSON.parse(readback) as unknown[];
        const confirmed =
          Array.isArray(parsed) &&
          parsed.some(
            (entry) =>
              isValidSavedPotteryItem(entry) && entry.id === verifyId
          );
        if (!confirmed) {
          return {
            ok: false,
            error: 'Could not verify saved creation in storage.',
          };
        }
      }
      return { ok: true, data: items };
    } catch {
      return {
        ok: false,
        error:
          'Local storage is full or blocked. Free up space or export your pottery as GLB.',
      };
    }
  }
}
