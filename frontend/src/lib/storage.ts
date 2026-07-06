/**
 * WARNING / DISCLAIMER:
 * This module implements a client-side encrypted storage mechanism using browser IndexedDB
 * and key derivation from Freighter wallet signatures. This pattern is appropriate ONLY
 * for testnet demos and local proofs-of-concept.
 * 
 * A production-grade system requires proper off-chain decentralized encrypted storage
 * (e.g. IPFS, Arweave) combined with secure decentralized key management systems (e.g. Lit Protocol,
 * Torus, or hardware-enclave derived keys). Do NOT use this local IndexedDB-only pattern in production.
 */

import { Buffer } from 'buffer';

const DB_NAME = 'vouchsafe_db';
const STORE_NAME = 'credentials';
const DB_VERSION = 1;

// Initialize IndexedDB database
function getDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('IndexedDB is only available in browser environments.'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'credentialId' });
      }
    };
  });
}

// Derive AES-GCM Key from signature using SHA-256
export async function deriveKeyFromSignature(signatureHex: string): Promise<CryptoKey> {
  const signatureBytes = new Uint8Array(Buffer.from(signatureHex, 'hex'));
  const hash = await window.crypto.subtle.digest('SHA-256', signatureBytes);
  return await window.crypto.subtle.importKey(
    'raw',
    hash,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
}

// Encrypt and store credential data in IndexedDB
export async function storeEncryptedCredential(
  credentialId: number,
  rawPayload: any,
  key: CryptoKey
): Promise<void> {
  const db = await getDB();
  const jsonStr = JSON.stringify(rawPayload);
  const encoded = new TextEncoder().encode(jsonStr);
  
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const ciphertextBuffer = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new Uint8Array(encoded)
  );
  
  const ciphertextHex = Buffer.from(ciphertextBuffer).toString('hex');
  const ivHex = Buffer.from(iv).toString('hex');
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const putRequest = store.put({
      credentialId,
      iv: ivHex,
      ciphertext: ciphertextHex
    });
    
    putRequest.onerror = () => reject(putRequest.error);
    putRequest.onsuccess = () => resolve();
  });
}

// Get and decrypt credential data from IndexedDB
export async function getDecryptedCredential(
  credentialId: number,
  key: CryptoKey
): Promise<any | null> {
  const db = await getDB();
  
  const record: any = await new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const getRequest = store.get(credentialId);
    
    getRequest.onerror = () => reject(getRequest.error);
    getRequest.onsuccess = () => resolve(getRequest.result);
  });
  
  if (!record) return null;
  
  const iv = new Uint8Array(Buffer.from(record.iv, 'hex'));
  const ciphertext = new Uint8Array(Buffer.from(record.ciphertext, 'hex'));

  try {
    const decryptedBuffer = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    );
    const decodedStr = new TextDecoder().decode(decryptedBuffer);
    return JSON.parse(decodedStr);
  } catch (err) {
    console.error('Failed to decrypt credential data. Ensure wallet signature key is valid.', err);
    throw new Error('Decryption failed. Invalid wallet decryption key.');
  }
}
