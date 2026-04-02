import { put, get } from "@vercel/blob";

export interface StoredShareCode {
  code: string;
  preamble: string;
  previewImageId: string;
  createdAt: number;
}

const BASE62_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/**
 * Generate a short ID using timestamp + random bytes, encoded as base62
 * Results in ~7-9 character IDs
 */
export function generateShortId(): string {
  // 8 bytes: 4 for timestamp (ms since epoch / 1000), 4 for random
  const now = Math.floor(Date.now() / 1000); // seconds, fits in 4 bytes
  const rand = Math.floor(Math.random() * 0xffffffff); // random 4 bytes

  let num = (BigInt(now) << 32n) | BigInt(rand);

  let result = "";
  while (num > 0n) {
    result = BASE62_ALPHABET[Number(num % 62n)] + result;
    num = num / 62n;
  }

  return result || "0";
}

/**
 * Store circuit code and preamble, returning a short ID
 */
export async function storeShareCode(code: string, preamble: string, previewImageId = ""): Promise<string> {
  const id = generateShortId();
  const data: StoredShareCode = {
    code,
    preamble,
    previewImageId,
    createdAt: Date.now()
  };

  try {
    await put(`share-codes/${id}.json`, JSON.stringify(data), {
      access: "private",
      addRandomSuffix: false,
      contentType: "application/json"
    });
  } catch (error) {
    // Fallback for local development - use a simple in-memory store
    if (!globalThis.__shareCodeStore) {
      globalThis.__shareCodeStore = new Map<string, StoredShareCode>();
    }
    globalThis.__shareCodeStore.set(id, data);
  }

  return id;
}

/**
 * Retrieve circuit code and preamble by short ID
 */
export async function retrieveShareCode(id: string): Promise<StoredShareCode | null> {
  try {
    const blob = await get(`share-codes/${id}.json`, { access: "private" });
    if (!blob || blob.statusCode === 404) {
      return null;
    }
    if (blob.statusCode !== 200) {
      throw new Error(`Unable to read tiny share payload ${id}.`);
    }

    const text = await new Response(blob.stream).text();
    return JSON.parse(text);
  } catch (error) {
    // Fallback for local development
    if (globalThis.__shareCodeStore) {
      return globalThis.__shareCodeStore.get(id) || null;
    }
    return null;
  }
}

/**
 * Clean up old share codes (optional, called manually or by cron)
 */
export async function cleanupOldShareCodes(maxAgeMs = 30 * 24 * 60 * 60 * 1000): Promise<void> {
  // Note: Vercel Blob doesn't have list() yet, so this is a placeholder
  // In production, you'd implement this with a separate database
  try {
    // TODO: Implement cleanup when Vercel Blob supports listing
  } catch (error) {
    // Ignore
  }
}

declare global {
  var __shareCodeStore: Map<string, StoredShareCode> | undefined;
}
