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

// Add userId parameter
export const storePrivateKey = async (userId, privateKey) => {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, "readwrite");
  // Use the unique userId as the 'id' (the keyPath)
  tx.objectStore(STORE_NAME).put({ id: userId, key: privateKey });
};

// Add userId parameter
export const getPrivateKey = async (userId) => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    // Use the unique userId to get the correct private key
    const req = tx.objectStore(STORE_NAME).get(userId);
    req.onsuccess = () => resolve(req.result ? req.result.key : null);
    req.onerror = () => reject("Key not found");
  });
};