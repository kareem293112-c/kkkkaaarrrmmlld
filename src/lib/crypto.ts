/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Secure Client-Side End-to-End Encryption (E2EE) Module
 * Powered by standard Web Crypto API (SubtleCrypto)
 */

// Helper to convert ArrayBuffer to Base64
export function bufferToBase64(buf: ArrayBuffer): string {
  const binstr = Array.prototype.map.call(new Uint8Array(buf), (ch: number) => String.fromCharCode(ch)).join('');
  return btoa(binstr);
}

// Helper to convert Base64 to ArrayBuffer
export function base64ToBuffer(base64: string): ArrayBuffer {
  const binstr = atob(base64);
  const buf = new Uint8Array(binstr.length);
  for (let i = 0; i < binstr.length; i++) {
    buf[i] = binstr.charCodeAt(i);
  }
  return buf.buffer;
}

/**
 * Derives a 256-bit AES-GCM Symmetric Session Key from a passphrase and salt.
 * We use the room ID as part of the salt so that the same passphrase produces
 * a different key in different rooms.
 */
export async function deriveRoomKey(passphrase: string, roomId: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  
  // Use roomId as salt (must be at least 8 bytes, so we pad/manipulate it)
  let saltString = `SadaSalt-${roomId}`;
  while (saltString.length < 16) {
    saltString += "-SadaE2EE";
  }
  const salt = enc.encode(saltString);

  // Import the user passphrase as Raw Key material
  const keyMaterial = await window.crypto.subtle.importKey(
    "raw",
    enc.encode(passphrase),
    { name: "PBKDF2" },
    false,
    ["deriveBits", "deriveKey"]
  );

  // Derive the 256-bit AES-GCM Key using PBKDF2 with 100k iterations and SHA-256
  return await window.crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt,
      iterations: 100000,
      hash: "SHA-256"
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Encrypts a message string using an AES-GCM key and a random 12-byte IV.
 * Returns the base64 ciphertext and the base64 initialization vector (IV).
 */
export async function encryptMessage(plaintext: string, key: CryptoKey): Promise<{ ciphertext: string; iv: string }> {
  const enc = new TextEncoder();
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  
  const encrypted = await window.crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv
    },
    key,
    enc.encode(plaintext)
  );

  return {
    ciphertext: bufferToBase64(encrypted),
    iv: bufferToBase64(iv.buffer)
  };
}

/**
 * Decrypts an AES-GCM encrypted ciphertext base64 string.
 * Returns the decrypted plaintext string.
 */
export async function decryptMessage(ciphertextBase64: string, ivBase64: string, key: CryptoKey): Promise<string> {
  const dec = new TextDecoder();
  const ciphertext = base64ToBuffer(ciphertextBase64);
  const iv = base64ToBuffer(ivBase64);

  const decrypted = await window.crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: new Uint8Array(iv)
    },
    key,
    ciphertext
  );

  return dec.decode(new Uint8Array(decrypted));
}

/**
 * Generates an RSA-OAEP asymmetric key pair for individual peer identity authentication.
 */
export async function generateRSAKeyPair(): Promise<CryptoKeyPair> {
  return await window.crypto.subtle.generateKey(
    {
      name: "RSA-OAEP",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256"
    },
    true,
    ["encrypt", "decrypt"]
  );
}

/**
 * Exports a public key to PEM/SPKI Base64 format.
 */
export async function exportPublicKey(key: CryptoKey): Promise<string> {
  const exported = await window.crypto.subtle.exportKey("spki", key);
  return bufferToBase64(exported);
}
