import { Pool, type QueryResult } from "pg";

const DATABASE_URL_ENV = "DATABASE_URL";

declare global {
  var __quantikzzDatabasePool: Pool | undefined;
  var __quantikzzDatabaseInitPromise: Promise<void> | undefined;
}

function getDatabaseUrl(): string {
  return process.env[DATABASE_URL_ENV]?.trim() || "";
}

function isSupportedDatabaseUrl(value: string): boolean {
  return value.startsWith("postgres://") || value.startsWith("postgresql://");
}

function shouldUseSsl(databaseUrl: string): boolean {
  try {
    const parsed = new URL(databaseUrl);
    return parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1";
  } catch {
    return false;
  }
}

function getPool(): Pool {
  const databaseUrl = getDatabaseUrl();
  if (!databaseUrl) {
    throw new Error(`${DATABASE_URL_ENV} is not configured.`);
  }

  if (!globalThis.__quantikzzDatabasePool) {
    globalThis.__quantikzzDatabasePool = new Pool({
      connectionString: databaseUrl,
      ssl: shouldUseSsl(databaseUrl) ? { rejectUnauthorized: false } : false
    });
  }

  return globalThis.__quantikzzDatabasePool;
}

async function initializeSchema(): Promise<void> {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS share_codes (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL,
      preamble TEXT NOT NULL,
      preview_image_id TEXT NOT NULL DEFAULT '',
      created_at BIGINT NOT NULL
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS share_previews (
      image_id TEXT PRIMARY KEY,
      content_type TEXT NOT NULL,
      image_bytes BYTEA NOT NULL,
      created_at BIGINT NOT NULL
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bug_reports (
      id TEXT PRIMARY KEY,
      submitted_at TEXT NOT NULL,
      status TEXT NOT NULL,
      archived_at TEXT,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      email TEXT,
      code TEXT NOT NULL,
      preamble TEXT NOT NULL,
      page_url TEXT,
      user_agent TEXT,
      visual_circuit_snapshot TEXT NOT NULL,
      session_snapshot TEXT NOT NULL,
      preview_image_content_type TEXT,
      interface_image_content_type TEXT
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bug_report_images (
      report_id TEXT NOT NULL REFERENCES bug_reports(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      content_type TEXT NOT NULL,
      image_bytes BYTEA NOT NULL,
      PRIMARY KEY (report_id, kind)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS bug_reports_status_submitted_idx
    ON bug_reports (status, submitted_at DESC)
  `);
}

async function ensureSchema(): Promise<void> {
  if (!globalThis.__quantikzzDatabaseInitPromise) {
    globalThis.__quantikzzDatabaseInitPromise = initializeSchema();
  }

  await globalThis.__quantikzzDatabaseInitPromise;
}

export function hasConfiguredDatabase(): boolean {
  return isSupportedDatabaseUrl(getDatabaseUrl());
}

export async function queryDatabase<T = unknown>(text: string, values: unknown[] = []): Promise<QueryResult<T>> {
  await ensureSchema();
  return getPool().query<T>(text, values);
}