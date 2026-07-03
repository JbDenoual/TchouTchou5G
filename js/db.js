// Petite couche IndexedDB : sert uniquement de tampon transitoire pendant
// l'enregistrement, pour ne rien perdre en zone sans réseau avant la synchro
// vers Supabase (source de vérité durable).

const DB_NAME = 'tchoutchou5g';
const DB_VERSION = 1;
const STORE = 'outbox';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'outboxId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// entry: { outboxId, table: 'trips'|'pings', payload: {...} }
export async function outboxAdd(entry) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function outboxGetAll() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function outboxRemove(outboxId) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(outboxId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Purge toute écriture en attente pour un trajet (utilisé à la suppression,
// pour éviter qu'une synchro tardive ne ressuscite le trajet ou ses pings).
export async function outboxRemoveByTripId(tripId) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const req = store.getAll();
    req.onsuccess = () => {
      req.result
        .filter((e) => (e.table === 'trips' ? e.payload.id === tripId : e.payload.trip_id === tripId))
        .forEach((e) => store.delete(e.outboxId));
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
