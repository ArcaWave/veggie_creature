// Device-local archive of every monster made on this tablet (IndexedDB).
// Viewable/exportable from the staff panel.
export type GalleryItem = {
  id: string;
  name: string;
  photo: string; // clay image data URL
  traits: string[];
  stars: number;
  profileId: string | null;
  createdAt: number;
};

const DB = "mk-gallery";
const STORE = "monsters";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveToGallery(item: GalleryItem): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(item);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* archive is best-effort */
  }
}

export async function listGallery(): Promise<GalleryItem[]> {
  try {
    const db = await open();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE, "readonly");
      const r = tx.objectStore(STORE).getAll();
      r.onsuccess = () => resolve((r.result as GalleryItem[]).sort((a, b) => b.createdAt - a.createdAt));
      r.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}
