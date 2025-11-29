// src/utils/crypto.js

// --- HELPER: ARRAY BUFFER TO BASE64 ---
export const ab2str = (buf) => {
  return btoa(String.fromCharCode.apply(null, new Uint8Array(buf)));
};

export const str2ab = (str) => {
  const binaryString = atob(str);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
};

// --- 1. IDENTITY KEY GENERATION (ECDSA P-256) ---
// Generated once at registration
export const generateIdentityKeyPair = async () => {
  return await window.crypto.subtle.generateKey(
    {
      name: "ECDSA",
      namedCurve: "P-256",
    },
    true, // Extractable
    ["sign", "verify"]
  );
};

// --- 2. EPHEMERAL KEY GENERATION (ECDH P-256) ---
// Generated for every new chat session
export const generateEphemeralKeyPair = async () => {
  return await window.crypto.subtle.generateKey(
    {
      name: "ECDH",
      namedCurve: "P-256",
    },
    true,
    ["deriveKey", "deriveBits"]
  );
};

// --- 3. DIGITAL SIGNATURE ---
export const signData = async (privateKey, data) => {
  const enc = new TextEncoder();
  const signature = await window.crypto.subtle.sign(
    {
      name: "ECDSA",
      hash: { name: "SHA-256" },
    },
    privateKey,
    enc.encode(data)
  );
  return ab2str(signature);
};

export const verifySignature = async (publicKey, signatureBase64, data) => {
  const enc = new TextEncoder();
  return await window.crypto.subtle.verify(
    {
      name: "ECDSA",
      hash: { name: "SHA-256" },
    },
    publicKey,
    str2ab(signatureBase64),
    enc.encode(data)
  );
};

// --- 4. DERIVE SHARED SESSION KEY (HKDF) ---
export const deriveSessionKey = async (localPrivateKey, remotePublicKeyRaw) => {
  // Import remote public key (which came as Raw/Base64)
  const remotePublicKey = await window.crypto.subtle.importKey(
    "raw",
    str2ab(remotePublicKeyRaw),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );

  // ECDH Derivation
  const sharedSecret = await window.crypto.subtle.deriveBits(
    {
      name: "ECDH",
      public: remotePublicKey,
    },
    localPrivateKey,
    256
  );

  // HKDF to create the actual AES-GCM Key
  const hkdfKey = await window.crypto.subtle.importKey(
    "raw",
    sharedSecret,
    { name: "HKDF" },
    false,
    ["deriveKey"]
  );

  return await window.crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(), // In prod, salt should be exchanged
      info: new TextEncoder().encode("secure-chat"),
    },
    hkdfKey,
    { name: "AES-GCM", length: 256 },
    true, // Extractable for debugging (set false in prod)
    ["encrypt", "decrypt"]
  );
};

// --- 5. AES-256-GCM ENCRYPTION ---
export const encryptMessage = async (sessionKey, text) => {
  const iv = window.crypto.getRandomValues(new Uint8Array(12)); // 12 bytes IV
  const enc = new TextEncoder();
  
  const ciphertext = await window.crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv,
    },
    sessionKey,
    enc.encode(text)
  );

  return {
    ciphertext: ab2str(ciphertext),
    iv: ab2str(iv),
  };
};

// --- 6. AES-256-GCM DECRYPTION ---
export const decryptMessage = async (sessionKey, ciphertextB64, ivB64) => {
  try {
    const decrypted = await window.crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: str2ab(ivB64),
      },
      sessionKey,
      str2ab(ciphertextB64)
    );
    return new TextDecoder().decode(decrypted);
  } catch (e) {
    console.error("Decryption failed", e);
    return "[DECRYPTION ERROR]";
  }
};

// --- KEY EXPORT HELPER (For sending keys over network) ---
export const exportKeyToRaw = async (key) => {
  const exported = await window.crypto.subtle.exportKey("raw", key);
  return ab2str(exported);
};

// Export JWK for Identity Public Key (to store in Mongo)
export const exportKeyToJWK = async (key) => {
    return await window.crypto.subtle.exportKey("jwk", key);
};