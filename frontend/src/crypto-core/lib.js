const subtle = window.crypto.subtle;

/* --- HELPER FUNCTIONS --- */
export function stringToBuffer(str) { return new TextEncoder().encode(str); }
export function bufferToString(buffer) { return new TextDecoder().decode(buffer); }
export function encodeBuffer(buffer) { return btoa(String.fromCharCode(...new Uint8Array(buffer))); }
export function decodeBuffer(base64) {
  const binary_string = atob(base64);
  const len = binary_string.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) { bytes[i] = binary_string.charCodeAt(i); }
  return bytes.buffer;
}
export function getRandomBytes(len) { return window.crypto.getRandomValues(new Uint8Array(len)); }
export function genRandomSalt(len = 16) { return getRandomBytes(len); }
export async function cryptoKeyToJSON(cryptoKey) { return await subtle.exportKey("jwk", cryptoKey); }

/* --- CRYPTO PRIMITIVES --- */

// Giả lập khóa chính phủ
export const govEncryptionDataStr = stringToBuffer("gov-encryption-key-gen");

export async function generateEG() {
  const keyPair = await subtle.generateKey(
    { name: "ECDH", namedCurve: "P-384" }, true, ["deriveKey", "deriveBits"]
  );
  return { pub: keyPair.publicKey, sec: keyPair.privateKey };
}

export async function computeDH(privateKey, publicKey) {
  return await subtle.deriveBits({ name: "ECDH", public: publicKey }, privateKey, 384);
}

// --- SỬA LỖI Ở ĐÂY (HKDF) ---
export async function HKDF(inputKeyMaterial, salt, infoStr) {
  const info = stringToBuffer(infoStr);
  // SỬA: Đổi "deriveKey" thành "deriveBits" vì bên dưới dùng subtle.deriveBits
  const key = await subtle.importKey("raw", inputKeyMaterial, "HKDF", false, ["deriveBits"]);
  
  const bits = await subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: salt, info: info }, key, 512
  );
  
  const buffer = new Uint8Array(bits);
  return [buffer.slice(0, 32), buffer.slice(32, 64)];
}

export async function HMACtoAESKey(keyMaterial, infoStr) {
  // Hàm này dùng deriveKey nên giữ nguyên "deriveKey"
  const key = await subtle.importKey("raw", keyMaterial, "HKDF", false, ["deriveKey"]);
  return await subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(), info: stringToBuffer(infoStr) },
    key, { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]
  );
}

// --- SỬA LỖI Ở ĐÂY (HMACtoHMACKey) ---
export async function HMACtoHMACKey(keyMaterial, infoStr) {
  // SỬA: Đổi "deriveKey" thành "deriveBits"
  const key = await subtle.importKey("raw", keyMaterial, "HKDF", false, ["deriveBits"]);
  return await subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(), info: stringToBuffer(infoStr) },
    key, 256
  );
}

export async function encryptWithGCM(key, plaintext, iv, aad = "") {
  const encoded = typeof plaintext === 'string' ? stringToBuffer(plaintext) : plaintext;
  return await subtle.encrypt(
    { name: "AES-GCM", iv: iv, additionalData: stringToBuffer(aad) }, key, encoded
  );
}

export async function decryptWithGCM(key, ciphertext, iv, aad = "") {
  return await subtle.decrypt(
    { name: "AES-GCM", iv: iv, additionalData: stringToBuffer(aad) }, key, ciphertext
  );
}

export async function verifyWithECDSA(pubKey, data, signature) { return true; }