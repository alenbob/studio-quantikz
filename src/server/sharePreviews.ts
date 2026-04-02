import { get, put } from "@vercel/blob";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const BLOB_SHARE_PREVIEW_PREFIX = "share-previews/";
const LOCAL_SHARE_PREVIEW_DIR = path.join(process.cwd(), "data", "share-previews");
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

  if (process.env.BLOB_READ_WRITE_TOKEN?.trim()) {
    await put(`${BLOB_SHARE_PREVIEW_PREFIX}${imageId}`, bytes, {
      access: "private",
      addRandomSuffix: false,
      contentType: "image/png"
    });
    return imageId;
  }

  if (process.env.VERCEL === "1") {
    throw new Error("Share preview storage is not configured. Set BLOB_READ_WRITE_TOKEN on Vercel.");
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

  if (process.env.BLOB_READ_WRITE_TOKEN?.trim()) {
    const result = await get(`${BLOB_SHARE_PREVIEW_PREFIX}${normalizedId}`, {
      access: "private"
    });
    if (!result || result.statusCode === 404) {
      return null;
    }
    if (result.statusCode !== 200) {
      throw new Error(`Unable to read share preview image ${normalizedId}.`);
    }

    const arrayBuffer = await new Response(result.stream).arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  // Local filename fallback (local dev without BLOB_READ_WRITE_TOKEN)

  if (process.env.VERCEL === "1") {
    throw new Error("Share preview storage is not configured. Set BLOB_READ_WRITE_TOKEN on Vercel.");
  }

  try {
    return await readFile(path.join(LOCAL_SHARE_PREVIEW_DIR, normalizedId));
  } catch {
    return null;
  }
}