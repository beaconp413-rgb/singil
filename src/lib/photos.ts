// Meter and receipt photos live in IndexedDB: localStorage caps out around 5 MB,
// which a year of photos for 10 units would blow through in a month.

const DB = "singil-photos";
const STORE = "photos";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req ? req.result : undefined);
    t.onerror = () => reject(t.error);
  });
}

export const putPhoto = (id: string, dataUrl: string) => tx("readwrite", (s) => void s.put(dataUrl, id));

export const getPhoto = (id: string) => tx<string | undefined>("readonly", (s) => s.get(id));

export const deletePhotos = (ids: string[]) => tx("readwrite", (s) => ids.forEach((id) => s.delete(id)));

export async function getPhotos(ids: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const id of ids) {
    const p = await getPhoto(id);
    if (p) out[id] = p;
  }
  return out;
}

/** Shrink a camera photo: 3–12 MB originals become ~150 KB JPEGs, plenty for reading digits. */
export async function toSmallJpeg(file: File, maxSide = 1280): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.8);
}
