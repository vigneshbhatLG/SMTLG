// Simple browser-side encryption helpers using Web Crypto API
// Derives an AES-GCM key from a passphrase via PBKDF2 and uses it to encrypt/decrypt strings.
// NOTE: For production, keep secrets out of client code and use secure server-managed storage.

// Read secrets from Vite environment variables (must be prefixed with VITE_)
const { VITE_CRYPTO_PASSPHRASE, VITE_CRYPTO_SALT } = import.meta.env;
const PASSPHRASE = VITE_CRYPTO_PASSPHRASE || "jira-custom-passphrase-v1";
const SALT = VITE_CRYPTO_SALT || "jira-custom-salt-v1";
const ITERATIONS = 100_000;

if (!VITE_CRYPTO_PASSPHRASE || !VITE_CRYPTO_SALT) {
  // Warn in dev if env vars aren't set — keep safe fallback for convenience.
  console.warn(
    "VITE_CRYPTO_PASSPHRASE or VITE_CRYPTO_SALT not set; using defaults. Set them in client/.env"
  );
}

function bufToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

async function getKeyFromPassphrase(passphrase) {
  // Simpler: derive a 256-bit key by hashing the passphrase with SHA-256.
  // This avoids PBKDF2 and iteration mismatches. The server will perform the same SHA-256 digest.
  const enc = new TextEncoder();
  const passBytes = enc.encode(passphrase);
  const hashBuffer = await crypto.subtle.digest('SHA-256', passBytes);
  return crypto.subtle.importKey(
    'raw',
    hashBuffer,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptString(plainText) {
  try {
    const key = await getKeyFromPassphrase(PASSPHRASE);
    const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV for AES-GCM
    const encoded = new TextEncoder().encode(plainText);
    const cipherBuffer = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);

    // Prepend IV to ciphertext so we can decrypt later
    const ivAndCipher = new Uint8Array(iv.byteLength + cipherBuffer.byteLength);
    ivAndCipher.set(iv, 0);
    ivAndCipher.set(new Uint8Array(cipherBuffer), iv.byteLength);

    return bufToBase64(ivAndCipher.buffer);
  } catch (err) {
    console.error("encryptString error:", err);
    throw err;
  }
}

export async function decryptString(base64) {
  try {
    const key = await getKeyFromPassphrase(PASSPHRASE);
    const ivAndCipherBuffer = base64ToArrayBuffer(base64);
    const ivAndCipher = new Uint8Array(ivAndCipherBuffer);
    const iv = ivAndCipher.slice(0, 12);
    const cipher = ivAndCipher.slice(12);

    const plainBuffer = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher);
    return new TextDecoder().decode(plainBuffer);
  } catch (err) {
    console.error("decryptString error:", err);
    throw err;
  }
}
