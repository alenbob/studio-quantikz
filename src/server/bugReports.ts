import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  BUG_REPORT_DESCRIPTION_MAX_LENGTH,
  BUG_REPORT_EMAIL_MAX_LENGTH,
  BUG_REPORT_TITLE_MAX_LENGTH,
  type BugReportStatus,
  type BugReportPayload,
  type StoredBugReport,
} from "../shared/bugReport.js";
import { hasConfiguredDatabase, queryDatabase } from "./database";

const LOCAL_STORAGE_PATH = process.env.BUG_REPORTS_FILE_PATH?.trim() || path.join(process.cwd(), "data", "bug-reports.jsonl");
const LOCAL_PREVIEW_IMAGE_DIR = path.join(path.dirname(LOCAL_STORAGE_PATH), "bug-report-images");
const LOCAL_INTERFACE_IMAGE_DIR = path.join(path.dirname(LOCAL_STORAGE_PATH), "bug-report-interface-images");
const BUG_REPORT_PREVIEW_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const BUG_REPORT_INTERFACE_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const BUG_REPORT_VISUAL_CIRCUIT_MAX_LENGTH = 1_000_000;
const BUG_REPORT_SESSION_SNAPSHOT_MAX_LENGTH = 1_000_000;
const DATABASE_REPORT_PREFIX = "db-report:";
const DATABASE_PREVIEW_IMAGE_PREFIX = "db-preview:";
const DATABASE_INTERFACE_IMAGE_PREFIX = "db-interface:";

export const BUG_REPORT_ADMIN_TOKEN_ENV = "BUG_REPORT_ADMIN_TOKEN";

interface DatabaseBugReportRow {
  id: string;
  submittedAt: string;
  status: BugReportStatus;
  archivedAt: string | null;
  title: string;
  description: string;
  email: string | null;
  code: string;
  preamble: string;
  pageUrl: string | null;
  userAgent: string | null;
  visualCircuitSnapshot: string;
  sessionSnapshot: string;
  previewImageContentType: string | null;
  interfaceImageContentType: string | null;
}

interface DatabaseBugReportImageRow {
  contentType: string;
  body: Buffer;
}

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
    visualCircuitSnapshot: normalizeField(payload.visualCircuitSnapshot).slice(0, BUG_REPORT_VISUAL_CIRCUIT_MAX_LENGTH),
    sessionSnapshot: normalizeField(payload.sessionSnapshot).slice(0, BUG_REPORT_SESSION_SNAPSHOT_MAX_LENGTH),
    previewImageStorageKey: null,
    previewImageContentType: null,
    interfaceImageStorageKey: null,
    interfaceImageContentType: null,
    storage,
    storageKey,
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
    bytes,
  };
}

function extensionForPreviewContentType(contentType: string): string {
  return contentType === "image/jpeg" ? "jpg" : "png";
}

function buildDatabaseReportStorageKey(reportId: string): string {
  return `${DATABASE_REPORT_PREFIX}${reportId}`;
}

function buildDatabaseImageStorageKey(reportId: string, kind: "preview" | "interface"): string {
  return `${kind === "preview" ? DATABASE_PREVIEW_IMAGE_PREFIX : DATABASE_INTERFACE_IMAGE_PREFIX}${reportId}`;
}

function parseDatabaseReportId(storageKey: string): string | null {
  if (!storageKey.startsWith(DATABASE_REPORT_PREFIX)) {
    return null;
  }

  const reportId = storageKey.slice(DATABASE_REPORT_PREFIX.length).trim();
  return reportId || null;
}

function parseDatabaseImageStorageKey(storageKey: string): { reportId: string; kind: "preview" | "interface" } | null {
  if (storageKey.startsWith(DATABASE_PREVIEW_IMAGE_PREFIX)) {
    const reportId = storageKey.slice(DATABASE_PREVIEW_IMAGE_PREFIX.length).trim();
    return reportId ? { reportId, kind: "preview" } : null;
  }

  if (storageKey.startsWith(DATABASE_INTERFACE_IMAGE_PREFIX)) {
    const reportId = storageKey.slice(DATABASE_INTERFACE_IMAGE_PREFIX.length).trim();
    return reportId ? { reportId, kind: "interface" } : null;
  }

  return null;
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
    || (candidate.storage !== "blob" && candidate.storage !== "database" && candidate.storage !== "file")
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
    visualCircuitSnapshot: typeof candidate.visualCircuitSnapshot === "string" ? candidate.visualCircuitSnapshot : "",
    sessionSnapshot: typeof candidate.sessionSnapshot === "string" ? candidate.sessionSnapshot : "",
    previewImageStorageKey: typeof candidate.previewImageStorageKey === "string" ? candidate.previewImageStorageKey : null,
    previewImageContentType: typeof candidate.previewImageContentType === "string" ? candidate.previewImageContentType : null,
    interfaceImageStorageKey: typeof candidate.interfaceImageStorageKey === "string" ? candidate.interfaceImageStorageKey : null,
    interfaceImageContentType: typeof candidate.interfaceImageContentType === "string" ? candidate.interfaceImageContentType : null,
    storage: candidate.storage,
    storageKey: candidate.storageKey,
  };
}

function mapDatabaseBugReport(row: DatabaseBugReportRow): StoredBugReport {
  return {
    id: row.id,
    submittedAt: row.submittedAt,
    status: row.status,
    archivedAt: row.archivedAt,
    title: row.title,
    description: row.description,
    email: row.email,
    code: row.code,
    preamble: row.preamble,
    pageUrl: row.pageUrl,
    userAgent: row.userAgent,
    visualCircuitSnapshot: row.visualCircuitSnapshot,
    sessionSnapshot: row.sessionSnapshot,
    previewImageStorageKey: row.previewImageContentType ? buildDatabaseImageStorageKey(row.id, "preview") : null,
    previewImageContentType: row.previewImageContentType,
    interfaceImageStorageKey: row.interfaceImageContentType ? buildDatabaseImageStorageKey(row.id, "interface") : null,
    interfaceImageContentType: row.interfaceImageContentType,
    storage: "database",
    storageKey: buildDatabaseReportStorageKey(row.id),
  };
}

async function storePreviewImageInFile(storageKey: string, bytes: Buffer): Promise<void> {
  await mkdir(path.dirname(storageKey), { recursive: true });
  await writeFile(storageKey, bytes);
}

async function storeBugReportInDatabase(payload: BugReportPayload): Promise<StoredBugReport> {
  const previewImage = parseImageDataUrl(payload.previewImageDataUrl, BUG_REPORT_PREVIEW_IMAGE_MAX_BYTES, "Preview image");
  const interfaceImage = parseImageDataUrl(payload.interfaceImageDataUrl, BUG_REPORT_INTERFACE_IMAGE_MAX_BYTES, "Interface image");
  const report = buildStoredBugReport(payload, "database", buildDatabaseReportStorageKey(crypto.randomUUID()));
  const reportId = parseDatabaseReportId(report.storageKey);

  if (!reportId) {
    throw new Error("Unable to allocate a bug report id.");
  }

  report.id = reportId;
  report.previewImageStorageKey = previewImage ? buildDatabaseImageStorageKey(reportId, "preview") : null;
  report.previewImageContentType = previewImage?.contentType ?? null;
  report.interfaceImageStorageKey = interfaceImage ? buildDatabaseImageStorageKey(reportId, "interface") : null;
  report.interfaceImageContentType = interfaceImage?.contentType ?? null;

  await queryDatabase(
    `
      INSERT INTO bug_reports (
        id, submitted_at, status, archived_at, title, description, email, code, preamble,
        page_url, user_agent, visual_circuit_snapshot, session_snapshot,
        preview_image_content_type, interface_image_content_type
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
    `,
    [
      report.id,
      report.submittedAt,
      report.status,
      report.archivedAt,
      report.title,
      report.description,
      report.email,
      report.code,
      report.preamble,
      report.pageUrl,
      report.userAgent,
      report.visualCircuitSnapshot,
      report.sessionSnapshot,
      report.previewImageContentType,
      report.interfaceImageContentType,
    ]
  );

  if (previewImage) {
    await queryDatabase(
      `
        INSERT INTO bug_report_images (report_id, kind, content_type, image_bytes)
        VALUES ($1, $2, $3, $4)
      `,
      [report.id, "preview", previewImage.contentType, previewImage.bytes]
    );
  }

  if (interfaceImage) {
    await queryDatabase(
      `
        INSERT INTO bug_report_images (report_id, kind, content_type, image_bytes)
        VALUES ($1, $2, $3, $4)
      `,
      [report.id, "interface", interfaceImage.contentType, interfaceImage.bytes]
    );
  }

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
  if (hasConfiguredDatabase()) {
    return storeBugReportInDatabase(payload);
  }

  return storeBugReportInFile(payload);
}

export async function readBugReportImage(storageKey: string): Promise<{ contentType: string; body: Buffer } | null> {
  const normalizedStorageKey = storageKey.trim();
  if (!normalizedStorageKey) {
    throw new Error("Bug report image storage key is required.");
  }

  if (hasConfiguredDatabase()) {
    const parsed = parseDatabaseImageStorageKey(normalizedStorageKey);
    if (!parsed) {
      throw new Error("Invalid bug report image storage key.");
    }

    const result = await queryDatabase<DatabaseBugReportImageRow>(
      `
        SELECT content_type AS "contentType", image_bytes AS body
        FROM bug_report_images
        WHERE report_id = $1 AND kind = $2
      `,
      [parsed.reportId, parsed.kind]
    );
    if (result.rowCount === 0) {
      return null;
    }

    return result.rows[0];
  }

  const normalizedLocalPath = path.normalize(normalizedStorageKey);
  const isPreviewImagePath = normalizedLocalPath.startsWith(LOCAL_PREVIEW_IMAGE_DIR + path.sep);
  const isInterfaceImagePath = normalizedLocalPath.startsWith(LOCAL_INTERFACE_IMAGE_DIR + path.sep);
  if (!isPreviewImagePath && !isInterfaceImagePath) {
    throw new Error("Invalid bug report image storage key.");
  }

  return {
    contentType: normalizedLocalPath.endsWith(".jpg") || normalizedLocalPath.endsWith(".jpeg") ? "image/jpeg" : "image/png",
    body: await readFile(normalizedLocalPath),
  };
}

async function listBugReportsFromDatabase(limit: number, status: BugReportStatus): Promise<StoredBugReport[]> {
  const result = await queryDatabase<DatabaseBugReportRow>(
    `
      SELECT
        id,
        submitted_at AS "submittedAt",
        status,
        archived_at AS "archivedAt",
        title,
        description,
        email,
        code,
        preamble,
        page_url AS "pageUrl",
        user_agent AS "userAgent",
        visual_circuit_snapshot AS "visualCircuitSnapshot",
        session_snapshot AS "sessionSnapshot",
        preview_image_content_type AS "previewImageContentType",
        interface_image_content_type AS "interfaceImageContentType"
      FROM bug_reports
      WHERE status = $1
      ORDER BY submitted_at DESC
      LIMIT $2
    `,
    [status, limit]
  );

  return result.rows.map(mapDatabaseBugReport);
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

  if (hasConfiguredDatabase()) {
    return listBugReportsFromDatabase(limit, status);
  }

  const reports = await listBugReportsFromFile(Math.max(limit * 3, limit));
  return reports.filter((report) => report.status === status).slice(0, limit);
}

async function readBugReportRecord(storageKey: string): Promise<StoredBugReport | null> {
  const normalizedStorageKey = storageKey.trim();
  if (!normalizedStorageKey) {
    throw new Error("Bug report storage key is required.");
  }

  if (hasConfiguredDatabase()) {
    const reportId = parseDatabaseReportId(normalizedStorageKey);
    if (!reportId) {
      throw new Error("Invalid bug report storage key.");
    }

    const result = await queryDatabase<DatabaseBugReportRow>(
      `
        SELECT
          id,
          submitted_at AS "submittedAt",
          status,
          archived_at AS "archivedAt",
          title,
          description,
          email,
          code,
          preamble,
          page_url AS "pageUrl",
          user_agent AS "userAgent",
          visual_circuit_snapshot AS "visualCircuitSnapshot",
          session_snapshot AS "sessionSnapshot",
          preview_image_content_type AS "previewImageContentType",
          interface_image_content_type AS "interfaceImageContentType"
        FROM bug_reports
        WHERE id = $1
      `,
      [reportId]
    );

    if (result.rowCount === 0) {
      return null;
    }

    return mapDatabaseBugReport(result.rows[0]);
  }

  const reports = await listBugReportsFromFile(Number.MAX_SAFE_INTEGER);
  return reports.find((report) => report.storageKey === normalizedStorageKey) ?? null;
}

async function writeBugReportRecord(report: StoredBugReport): Promise<void> {
  if (hasConfiguredDatabase()) {
    await queryDatabase(
      `
        UPDATE bug_reports
        SET status = $2, archived_at = $3
        WHERE id = $1
      `,
      [report.id, report.status, report.archivedAt]
    );
    return;
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
    archivedAt: new Date().toISOString(),
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