import { get, list, put } from "@vercel/blob";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  BUG_REPORT_DESCRIPTION_MAX_LENGTH,
  BUG_REPORT_EMAIL_MAX_LENGTH,
  BUG_REPORT_TITLE_MAX_LENGTH,
  type BugReportStatus,
  type BugReportPayload,
  type StoredBugReport
} from "../shared/bugReport.js";

const LOCAL_STORAGE_PATH = process.env.BUG_REPORTS_FILE_PATH?.trim() || path.join(process.cwd(), "data", "bug-reports.jsonl");
const LOCAL_PREVIEW_IMAGE_DIR = path.join(path.dirname(LOCAL_STORAGE_PATH), "bug-report-images");
const LOCAL_INTERFACE_IMAGE_DIR = path.join(path.dirname(LOCAL_STORAGE_PATH), "bug-report-interface-images");
const BUG_REPORT_PREVIEW_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const BUG_REPORT_INTERFACE_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const BUG_REPORT_SESSION_SNAPSHOT_MAX_LENGTH = 1_000_000;
const BLOB_PREVIEW_IMAGE_PREFIX = "bug-report-images/";
const BLOB_INTERFACE_IMAGE_PREFIX = "bug-report-interface-images/";

export const BUG_REPORT_ADMIN_TOKEN_ENV = "BUG_REPORT_ADMIN_TOKEN";

function normalizeField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeOptionalField(value: unknown, maxLength: number): string | null {
  const normalized = normalizeField(value).slice(0, maxLength);
  return normalized || null;
}

function normalizeRequiredField(fieldName: string, value: unknown, maxLength: number): string {
  const normalized = normalizeField(value).slice(0, maxLength);
  if (!normalized) {
    throw new Error(`${fieldName} is required.`);
  }

  return normalized;
}

function buildStoredBugReport(payload: BugReportPayload, storage: StoredBugReport["storage"], storageKey: string): StoredBugReport {
  const submittedAt = new Date().toISOString();

  return {
    id: crypto.randomUUID(),
    submittedAt,
    status: "active",
    archivedAt: null,
    title: normalizeRequiredField("Title", payload.title, BUG_REPORT_TITLE_MAX_LENGTH),
    description: normalizeRequiredField("Description", payload.description, BUG_REPORT_DESCRIPTION_MAX_LENGTH),
    email: normalizeOptionalField(payload.email, BUG_REPORT_EMAIL_MAX_LENGTH),
    code: normalizeField(payload.code),
    preamble: normalizeField(payload.preamble),
    pageUrl: normalizeOptionalField(payload.pageUrl, 2048),
    userAgent: normalizeOptionalField(payload.userAgent, 1024),
    sessionSnapshot: normalizeField(payload.sessionSnapshot).slice(0, BUG_REPORT_SESSION_SNAPSHOT_MAX_LENGTH),
    previewImageStorageKey: null,
    previewImageContentType: null,
    interfaceImageStorageKey: null,
    interfaceImageContentType: null,
    storage,
    storageKey
  };
}

function parseImageDataUrl(value: unknown, maxBytes: number, fieldLabel: string): { contentType: string; bytes: Buffer } | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const match = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$/i.exec(trimmed);
  if (!match) {
    throw new Error(`${fieldLabel} must be a PNG or JPEG data URL.`);
  }

  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length) {
    throw new Error(`${fieldLabel} is empty.`);
  }
  if (bytes.length > maxBytes) {
    throw new Error(`${fieldLabel} is too large.`);
  }

  return {
    contentType: match[1].toLowerCase(),
    bytes
  };
}

function extensionForPreviewContentType(contentType: string): string {
  return contentType === "image/jpeg" ? "jpg" : "png";
}

async function storePreviewImageInBlob(storageKey: string, contentType: string, bytes: Buffer): Promise<void> {
  await put(storageKey, bytes, {
    access: "private",
    addRandomSuffix: false,
    contentType
  });
}

async function storePreviewImageInFile(storageKey: string, bytes: Buffer): Promise<void> {
  await mkdir(path.dirname(storageKey), { recursive: true });
  await writeFile(storageKey, bytes);
}

async function storeBugReportInBlob(payload: BugReportPayload): Promise<StoredBugReport> {
  const reportId = crypto.randomUUID();
  const submittedAt = new Date().toISOString();
  const storageKey = `bug-reports/${submittedAt.replace(/[:.]/g, "-")}-${reportId}.json`;
  const previewImage = parseImageDataUrl(payload.previewImageDataUrl, BUG_REPORT_PREVIEW_IMAGE_MAX_BYTES, "Preview image");
  const interfaceImage = parseImageDataUrl(payload.interfaceImageDataUrl, BUG_REPORT_INTERFACE_IMAGE_MAX_BYTES, "Interface image");
  const previewImageStorageKey = previewImage
    ? `bug-report-images/${submittedAt.replace(/[:.]/g, "-")}-${reportId}.${extensionForPreviewContentType(previewImage.contentType)}`
    : null;
  const interfaceImageStorageKey = interfaceImage
    ? `bug-report-interface-images/${submittedAt.replace(/[:.]/g, "-")}-${reportId}.${extensionForPreviewContentType(interfaceImage.contentType)}`
    : null;
  const report = {
    id: reportId,
    submittedAt,
    status: "active" as const,
    archivedAt: null,
    title: normalizeRequiredField("Title", payload.title, BUG_REPORT_TITLE_MAX_LENGTH),
    description: normalizeRequiredField("Description", payload.description, BUG_REPORT_DESCRIPTION_MAX_LENGTH),
    email: normalizeOptionalField(payload.email, BUG_REPORT_EMAIL_MAX_LENGTH),
    code: normalizeField(payload.code),
    preamble: normalizeField(payload.preamble),
    pageUrl: normalizeOptionalField(payload.pageUrl, 2048),
    userAgent: normalizeOptionalField(payload.userAgent, 1024),
    sessionSnapshot: normalizeField(payload.sessionSnapshot).slice(0, BUG_REPORT_SESSION_SNAPSHOT_MAX_LENGTH),
    previewImageStorageKey,
    previewImageContentType: previewImage?.contentType ?? null,
    interfaceImageStorageKey,
    interfaceImageContentType: interfaceImage?.contentType ?? null,
    storage: "blob" as const,
    storageKey
  };

  if (previewImage && previewImageStorageKey) {
    await storePreviewImageInBlob(previewImageStorageKey, previewImage.contentType, previewImage.bytes);
  }
  if (interfaceImage && interfaceImageStorageKey) {
    await storePreviewImageInBlob(interfaceImageStorageKey, interfaceImage.contentType, interfaceImage.bytes);
  }

  await put(storageKey, JSON.stringify(report, null, 2), {
    access: "private",
    addRandomSuffix: false,
    contentType: "application/json"
  });

  return report;
}

async function storeBugReportInFile(payload: BugReportPayload): Promise<StoredBugReport> {
  const previewImage = parseImageDataUrl(payload.previewImageDataUrl, BUG_REPORT_PREVIEW_IMAGE_MAX_BYTES, "Preview image");
  const interfaceImage = parseImageDataUrl(payload.interfaceImageDataUrl, BUG_REPORT_INTERFACE_IMAGE_MAX_BYTES, "Interface image");
  const storageKey = LOCAL_STORAGE_PATH;
  const report = buildStoredBugReport(payload, "file", storageKey);
  if (previewImage) {
    const previewImageStorageKey = path.join(LOCAL_PREVIEW_IMAGE_DIR, `${report.id}.${extensionForPreviewContentType(previewImage.contentType)}`);
    await storePreviewImageInFile(previewImageStorageKey, previewImage.bytes);
    report.previewImageStorageKey = previewImageStorageKey;
    report.previewImageContentType = previewImage.contentType;
  }
  if (interfaceImage) {
    const interfaceImageStorageKey = path.join(LOCAL_INTERFACE_IMAGE_DIR, `${report.id}.${extensionForPreviewContentType(interfaceImage.contentType)}`);
    await storePreviewImageInFile(interfaceImageStorageKey, interfaceImage.bytes);
    report.interfaceImageStorageKey = interfaceImageStorageKey;
    report.interfaceImageContentType = interfaceImage.contentType;
  }
  await mkdir(path.dirname(LOCAL_STORAGE_PATH), { recursive: true });
  await appendFile(LOCAL_STORAGE_PATH, `${JSON.stringify(report)}\n`, "utf8");
  return report;
}

export async function storeBugReport(payload: BugReportPayload): Promise<StoredBugReport> {
  if (process.env.BLOB_READ_WRITE_TOKEN?.trim()) {
    return storeBugReportInBlob(payload);
  }

  if (process.env.VERCEL === "1") {
    throw new Error("Bug report storage is not configured. Set BLOB_READ_WRITE_TOKEN on Vercel.");
  }

  return storeBugReportInFile(payload);
}

function parseStoredBugReport(raw: unknown): StoredBugReport {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid bug report record.");
  }

  const candidate = raw as Partial<StoredBugReport>;
  if (
    typeof candidate.id !== "string"
    || typeof candidate.submittedAt !== "string"
    || (candidate.status !== undefined && candidate.status !== "active" && candidate.status !== "archived")
    || typeof candidate.title !== "string"
    || typeof candidate.description !== "string"
    || typeof candidate.code !== "string"
    || typeof candidate.preamble !== "string"
    || typeof candidate.storageKey !== "string"
    || (candidate.storage !== "blob" && candidate.storage !== "file")
  ) {
    throw new Error("Invalid bug report record.");
  }

  return {
    id: candidate.id,
    submittedAt: candidate.submittedAt,
    status: candidate.status === "archived" ? "archived" : "active",
    archivedAt: typeof candidate.archivedAt === "string" ? candidate.archivedAt : null,
    title: candidate.title,
    description: candidate.description,
    email: typeof candidate.email === "string" ? candidate.email : null,
    code: candidate.code,
    preamble: candidate.preamble,
    pageUrl: typeof candidate.pageUrl === "string" ? candidate.pageUrl : null,
    userAgent: typeof candidate.userAgent === "string" ? candidate.userAgent : null,
    sessionSnapshot: typeof candidate.sessionSnapshot === "string" ? candidate.sessionSnapshot : "",
    previewImageStorageKey: typeof candidate.previewImageStorageKey === "string" ? candidate.previewImageStorageKey : null,
    previewImageContentType: typeof candidate.previewImageContentType === "string" ? candidate.previewImageContentType : null,
    interfaceImageStorageKey: typeof candidate.interfaceImageStorageKey === "string" ? candidate.interfaceImageStorageKey : null,
    interfaceImageContentType: typeof candidate.interfaceImageContentType === "string" ? candidate.interfaceImageContentType : null,
    storage: candidate.storage,
    storageKey: candidate.storageKey
  };
}

export async function readBugReportImage(storageKey: string): Promise<{ contentType: string; body: Buffer } | null> {
  const normalizedStorageKey = storageKey.trim();
  if (!normalizedStorageKey) {
    throw new Error("Bug report image storage key is required.");
  }

  if (process.env.BLOB_READ_WRITE_TOKEN?.trim()) {
    if (!normalizedStorageKey.startsWith(BLOB_PREVIEW_IMAGE_PREFIX) && !normalizedStorageKey.startsWith(BLOB_INTERFACE_IMAGE_PREFIX)) {
      throw new Error("Invalid bug report image storage key.");
    }

    const result = await get(normalizedStorageKey, { access: "private" });
    if (!result || result.statusCode === 404) {
      return null;
    }
    if (result.statusCode !== 200) {
      throw new Error(`Unable to read bug report preview image ${normalizedStorageKey}.`);
    }

    const arrayBuffer = await new Response(result.stream).arrayBuffer();
    return {
      contentType: result.contentType || "image/png",
      body: Buffer.from(arrayBuffer)
    };
  }

  if (process.env.VERCEL === "1") {
    throw new Error("Bug report storage is not configured. Set BLOB_READ_WRITE_TOKEN on Vercel.");
  }

  const normalizedLocalPath = path.normalize(normalizedStorageKey);
  const isPreviewImagePath = normalizedLocalPath.startsWith(LOCAL_PREVIEW_IMAGE_DIR + path.sep);
  const isInterfaceImagePath = normalizedLocalPath.startsWith(LOCAL_INTERFACE_IMAGE_DIR + path.sep);
  if (!isPreviewImagePath && !isInterfaceImagePath) {
    throw new Error("Invalid bug report image storage key.");
  }

  return {
    contentType: normalizedLocalPath.endsWith(".jpg") || normalizedLocalPath.endsWith(".jpeg") ? "image/jpeg" : "image/png",
    body: await readFile(normalizedLocalPath)
  };
}

async function listBugReportsFromBlob(limit: number): Promise<StoredBugReport[]> {
  const response = await list({ prefix: "bug-reports/", limit });
  const reports = await Promise.all(
    response.blobs.map(async (blob) => {
      const result = await get(blob.pathname, { access: "private" });
      if (!result || result.statusCode !== 200) {
        throw new Error(`Unable to read bug report blob ${blob.pathname}.`);
      }

      const body = await new Response(result.stream).text();
      return parseStoredBugReport(JSON.parse(body));
    })
  );

  return reports.sort((left, right) => right.submittedAt.localeCompare(left.submittedAt));
}

async function listBugReportsFromFile(limit: number): Promise<StoredBugReport[]> {
  const raw = await readFile(LOCAL_STORAGE_PATH, "utf8");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => parseStoredBugReport(JSON.parse(line)))
    .slice(-limit)
    .reverse();
}

export async function listBugReports(limit = 50, status: BugReportStatus = "active"): Promise<StoredBugReport[]> {
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error("Bug report limit must be a positive integer.");
  }

  if (status !== "active" && status !== "archived") {
    throw new Error("Bug report status must be active or archived.");
  }

  const reports = process.env.BLOB_READ_WRITE_TOKEN?.trim()
    ? await listBugReportsFromBlob(Math.max(limit * 3, limit))
    : process.env.VERCEL === "1"
      ? (() => {
        throw new Error("Bug report storage is not configured. Set BLOB_READ_WRITE_TOKEN on Vercel.");
      })()
      : await listBugReportsFromFile(Math.max(limit * 3, limit));

  return reports.filter((report) => report.status === status).slice(0, limit);
}

async function readBugReportRecord(storageKey: string): Promise<StoredBugReport | null> {
  const normalizedStorageKey = storageKey.trim();
  if (!normalizedStorageKey) {
    throw new Error("Bug report storage key is required.");
  }

  if (process.env.BLOB_READ_WRITE_TOKEN?.trim()) {
    if (!normalizedStorageKey.startsWith("bug-reports/")) {
      throw new Error("Invalid bug report storage key.");
    }

    const result = await get(normalizedStorageKey, { access: "private" });
    if (!result || result.statusCode === 404) {
      return null;
    }
    if (result.statusCode !== 200) {
      throw new Error(`Unable to read bug report ${normalizedStorageKey}.`);
    }

    const body = await new Response(result.stream).text();
    return parseStoredBugReport(JSON.parse(body));
  }

  if (process.env.VERCEL === "1") {
    throw new Error("Bug report storage is not configured. Set BLOB_READ_WRITE_TOKEN on Vercel.");
  }

  const reports = await listBugReportsFromFile(Number.MAX_SAFE_INTEGER);
  return reports.find((report) => report.storageKey === normalizedStorageKey) ?? null;
}

async function writeBugReportRecord(report: StoredBugReport): Promise<void> {
  if (process.env.BLOB_READ_WRITE_TOKEN?.trim()) {
    await put(report.storageKey, JSON.stringify(report, null, 2), {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json"
    });
    return;
  }

  if (process.env.VERCEL === "1") {
    throw new Error("Bug report storage is not configured. Set BLOB_READ_WRITE_TOKEN on Vercel.");
  }

  const raw = await readFile(LOCAL_STORAGE_PATH, "utf8");
  const nextLines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => parseStoredBugReport(JSON.parse(line)))
    .map((entry) => entry.storageKey === report.storageKey ? report : entry)
    .map((entry) => JSON.stringify(entry));

  await writeFile(LOCAL_STORAGE_PATH, `${nextLines.join("\n")}\n`, "utf8");
}

export async function archiveBugReport(storageKey: string): Promise<StoredBugReport> {
  const report = await readBugReportRecord(storageKey);
  if (!report) {
    throw new Error("Bug report not found.");
  }

  if (report.status === "archived") {
    return report;
  }

  const archivedReport: StoredBugReport = {
    ...report,
    status: "archived",
    archivedAt: new Date().toISOString()
  };

  await writeBugReportRecord(archivedReport);
  return archivedReport;
}

export function validateBugReportAdminToken(providedToken: string | null | undefined): void {
  const expectedToken = process.env[BUG_REPORT_ADMIN_TOKEN_ENV]?.trim();
  if (!expectedToken) {
    throw new Error(`${BUG_REPORT_ADMIN_TOKEN_ENV} is not configured.`);
  }
  if (!providedToken || providedToken.trim() !== expectedToken) {
    throw new Error("Invalid bug report admin token.");
  }
}