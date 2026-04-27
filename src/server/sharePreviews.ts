import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { hasConfiguredDatabase, queryDatabase } from "./database";

const BLOB_SHARE_PREVIEW_PREFIX = "share-previews/";
const LOCAL_SHARE_PREVIEW_DIR = process.env.SHARE_PREVIEWS_DIR?.trim() || path.join(process.cwd(), "data", "share-previews");
const SHARE_PREVIEW_MAX_BYTES = 5 * 1024 * 1024;

function parsePngDataUrl(value: string): Buffer {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/i.exec(value.trim());
  if (!match) {
    throw new Error("Share preview image must be a PNG data URL.");
  }

  const bytes = Buffer.from(match[1], "base64");
  if (!bytes.length) {
    throw new Error("Share preview image is empty.");
  }
  if (bytes.length > SHARE_PREVIEW_MAX_BYTES) {
    throw new Error("Share preview image is too large.");
  }

  return bytes;
}

function buildImageId(): string {
  const id = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  return `${id}.png`;
}

function assertValidImageId(imageId: string): string {
  const normalized = imageId.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.png$/.test(normalized)) {
    throw new Error("Invalid share preview image id.");
  }

  return normalized;
}

export async function storeSharePreviewImage(imageDataUrl: string): Promise<string> {
  const bytes = parsePngDataUrl(imageDataUrl);
  const imageId = buildImageId();

  if (hasConfiguredDatabase()) {
    await queryDatabase(
      `
        INSERT INTO share_previews (image_id, content_type, image_bytes, created_at)
        VALUES ($1, $2, $3, $4)
      `,
      [imageId, "image/png", bytes, Date.now()]
    );
    return imageId;
  }

  await mkdir(LOCAL_SHARE_PREVIEW_DIR, { recursive: true });
  await writeFile(path.join(LOCAL_SHARE_PREVIEW_DIR, imageId), bytes);
  return imageId;
}

export async function readSharePreviewImage(imageId: string): Promise<Buffer | null> {
  const normalized = imageId.trim();

  // Legacy support for previously stored public Blob URLs.
  if (normalized.startsWith("https://")) {
    try {
      const url = new URL(normalized);
      if (!url.hostname.endsWith(".blob.vercel-storage.com")) {
        throw new Error("Invalid share preview image URL.");
      }
      const res = await fetch(normalized);
      if (!res.ok) return null;
      return Buffer.from(await res.arrayBuffer());
    } catch {
      return null;
    }
  }

  const normalizedId = assertValidImageId(normalized);

  if (hasConfiguredDatabase()) {
    const result = await queryDatabase<{ imageBytes: Buffer }>(
      `
        SELECT image_bytes AS "imageBytes"
        FROM share_previews
        WHERE image_id = $1
      `,
      [normalizedId]
    );
    if (result.rowCount === 0) {
      return null;
    }

    return result.rows[0].imageBytes;
  }

  try {
    return await readFile(path.join(LOCAL_SHARE_PREVIEW_DIR, normalizedId));
  } catch {
    return null;
  }
}