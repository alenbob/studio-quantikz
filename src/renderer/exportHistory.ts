const STORAGE_KEY = "quantikzz.export-history.v1";
const MAX_HISTORY_ENTRIES = 10;

export interface ExportHistoryEntry {
  id: string;
  createdAt: string;
  code: string;
  preamble: string;
  previewImage?: string;
}

function isExportHistoryEntry(value: unknown): value is ExportHistoryEntry {
  if (!value || typeof value !== "object") {
    return false;
  }

  const entry = value as Record<string, unknown>;
  return (
    typeof entry.id === "string" &&
    typeof entry.createdAt === "string" &&
    typeof entry.code === "string" &&
    typeof entry.preamble === "string" &&
    (typeof entry.previewImage === "undefined" || typeof entry.previewImage === "string")
  );
}

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function loadExportHistory(): ExportHistoryEntry[] {
  if (!canUseStorage()) {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isExportHistoryEntry) : [];
  } catch {
    return [];
  }
}

export function persistExportHistory(entries: ExportHistoryEntry[]): void {
  if (!canUseStorage()) {
    return;
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_HISTORY_ENTRIES)));
  } catch {
    // Ignore storage quota errors and keep the editor responsive.
  }
}

export function pushExportHistoryEntry(
  entries: ExportHistoryEntry[],
  entry: Omit<ExportHistoryEntry, "id" | "createdAt">
): ExportHistoryEntry[] {
  const nextEntry: ExportHistoryEntry = {
    id:
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    createdAt: new Date().toISOString(),
    ...entry
  };

  return [
    nextEntry,
    ...entries.filter((existing) => existing.code !== entry.code || existing.preamble !== entry.preamble)
  ].slice(0, MAX_HISTORY_ENTRIES);
}

export function getExportHistorySnippet(code: string): string {
  const firstLine = code
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  if (!firstLine) {
    return "Empty Quantikz export";
  }

  return firstLine.length > 88 ? `${firstLine.slice(0, 87)}...` : firstLine;
}
