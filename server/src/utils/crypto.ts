import * as crypto from 'crypto';

// AES-256-GCM parameters
const IV_LEN = 12; // 96 bits
const TAG_LEN = 16; // 128 bits

// Read key from environment. Prefer CRYPTO_KEY (base64 32 bytes). If not present,
// derive a 32-byte key from a passphrase using SHA-256 (deterministic, simple).
function getKey(): Buffer {
  const keyBase64 = process.env.CRYPTO_KEY || process.env.VITE_CRYPTO_KEY;
  if (keyBase64) {
    return Buffer.from(keyBase64, 'base64');
  }

  const passphrase = process.env.CRYPTO_PASSPHRASE || process.env.VITE_CRYPTO_PASSPHRASE || 'jira-custom-passphrase-v1';
  return crypto.createHash('sha256').update(String(passphrase), 'utf8').digest();
}

/**
 * Encrypt plaintext and return a single base64 string containing iv||ciphertext||tag
 */
export function encryptSymmetric(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([iv, ciphertext, tag]).toString('base64');
}

/**
 * Decrypt a base64 string produced by encryptSymmetric
 */
export function decryptSymmetric(base64: string): string {
  if (!base64 || typeof base64 !== 'string') {
    throw new Error('No data to decrypt');
  }

  const buf = Buffer.from(base64, 'base64');
  if (buf.length <= IV_LEN + TAG_LEN) {
    throw new Error('Invalid encrypted data');
  }

  const iv = buf.slice(0, IV_LEN);
  const tag = buf.slice(buf.length - TAG_LEN);
  const ciphertext = buf.slice(IV_LEN, buf.length - TAG_LEN);

  const key = getKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}
