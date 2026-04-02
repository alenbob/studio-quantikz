import { put } from "@vercel/blob";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

export interface TinyShareUsageRecord {
  id: string;
  shortId: string;
  accessedAt: string;
  resolved: boolean;
  host: string;
  referer: string | null;
  userAgent: string | null;
  forwardedFor: string | null;
  ipCountry: string | null;
  ipRegion: string | null;
  ipCity: string | null;
  storage: "blob" | "file";
  storageKey: string;
}

const LOCAL_USAGE_LOG_PATH = process.env.SHARE_USAGE_LOG_FILE_PATH?.trim() || path.join(process.cwd(), "data", "share-usage.jsonl");

function normalizeString(value: unknown, maxLength: number): string {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().slice(0, maxLength);
}

function normalizeOptionalString(value: unknown, maxLength: number): string | null {
  const normalized = normalizeString(value, maxLength);
  return normalized || null;
}

function buildUsageRecord(
  shortId: string,
  resolved: boolean,
  request: any,
  storage: "blob" | "file",
  storageKey: string
): TinyShareUsageRecord {
  const forwardedForHeader = normalizeString(request.headers?.["x-forwarded-for"], 1024);
  const forwardedFor = forwardedForHeader
    ? forwardedForHeader.split(",").map((part) => part.trim()).filter(Boolean)[0] || null
    : null;

  return {
    id: crypto.randomUUID(),
    shortId: normalizeString(shortId, 128),
    accessedAt: new Date().toISOString(),
    resolved,
    host: normalizeString(request.headers?.["x-forwarded-host"] || request.headers?.host, 512),
    referer: normalizeOptionalString(request.headers?.referer, 2048),
    userAgent: normalizeOptionalString(request.headers?.["user-agent"], 1024),
    forwardedFor,
    ipCountry: normalizeOptionalString(request.headers?.["x-vercel-ip-country"], 64),
    ipRegion: normalizeOptionalString(request.headers?.["x-vercel-ip-country-region"], 64),
    ipCity: normalizeOptionalString(request.headers?.["x-vercel-ip-city"], 128),
    storage,
    storageKey
  };
}

async function storeUsageInBlob(shortId: string, resolved: boolean, request: any): Promise<void> {
  const now = new Date();
  const key = `share-usage/${now.toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID()}-${normalizeString(shortId, 64)}.json`;
  const record = buildUsageRecord(shortId, resolved, request, "blob", key);

  await put(key, JSON.stringify(record, null, 2), {
    access: "private",
    addRandomSuffix: false,
    contentType: "application/json"
  });
}

async function storeUsageInFile(shortId: string, resolved: boolean, request: any): Promise<void> {
  const record = buildUsageRecord(shortId, resolved, request, "file", LOCAL_USAGE_LOG_PATH);
  await mkdir(path.dirname(LOCAL_USAGE_LOG_PATH), { recursive: true });
  await appendFile(LOCAL_USAGE_LOG_PATH, `${JSON.stringify(record)}\n`, "utf8");
}

export async function logTinyShareUsage(shortId: string, resolved: boolean, request: any): Promise<void> {
  if (!normalizeString(shortId, 128)) {
    return;
  }

  if (process.env.BLOB_READ_WRITE_TOKEN?.trim()) {
    await storeUsageInBlob(shortId, resolved, request);
    return;
  }

  if (process.env.VERCEL === "1") {
    // In production on Vercel we only support Blob persistence for logs.
    return;
  }

  await storeUsageInFile(shortId, resolved, request);
}
