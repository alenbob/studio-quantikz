import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { hasConfiguredDatabase, queryDatabase } from "./database";

export interface StoredShareCode {
  code: string;
  preamble: string;
  previewImageId: string;
  createdAt: number;
}

const BASE62_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const LOCAL_SHARE_CODE_DIR = path.join(process.cwd(), "data", "share-codes");

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

  if (hasConfiguredDatabase()) {
    await queryDatabase(
      `
        INSERT INTO share_codes (id, code, preamble, preview_image_id, created_at)
        VALUES ($1, $2, $3, $4, $5)
      `,
      [id, data.code, data.preamble, data.previewImageId, data.createdAt]
    );
    return id;
  }

  await mkdir(LOCAL_SHARE_CODE_DIR, { recursive: true });
  await writeFile(path.join(LOCAL_SHARE_CODE_DIR, `${id}.json`), JSON.stringify(data), "utf8");

  return id;
}

/**
 * Retrieve circuit code and preamble by short ID
 */
export async function retrieveShareCode(id: string): Promise<StoredShareCode | null> {
  if (hasConfiguredDatabase()) {
    const result = await queryDatabase<StoredShareCode>(
      `
        SELECT code, preamble, preview_image_id AS "previewImageId", created_at AS "createdAt"
        FROM share_codes
        WHERE id = $1
      `,
      [id]
    );

    if (result.rowCount === 0) {
      return null;
    }

    return result.rows[0];
  }

  try {
    const text = await readFile(path.join(LOCAL_SHARE_CODE_DIR, `${id}.json`), "utf8");
    return JSON.parse(text) as StoredShareCode;
  } catch {
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
  if (hasConfiguredDatabase()) {
    await queryDatabase(
      `DELETE FROM share_codes WHERE created_at < $1`,
      [Date.now() - maxAgeMs]
    );
    return;
  }

  try {
    await rm(LOCAL_SHARE_CODE_DIR, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors.
  }
}

declare global {
  var __shareCodeStore: Map<string, StoredShareCode> | undefined;
}
