// src/utils/db.js
const DB_NAME = "SecureChatDB";
const STORE_NAME = "keys";

export const openDB = () => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject("DB Error");
  });
};

export const storePrivateKey = async (privateKey) => {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, "readwrite");
  tx.objectStore(STORE_NAME).put({ id: "identityKey", key: privateKey });
};

export const getPrivateKey = async () => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get("identityKey");
    req.onsuccess = () => resolve(req.result ? req.result.key : null);
    req.onerror = () => reject("Key not found");
  });
};