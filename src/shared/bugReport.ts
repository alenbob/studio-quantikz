export const BUG_REPORT_TITLE_MAX_LENGTH = 160;
export const BUG_REPORT_DESCRIPTION_MAX_LENGTH = 4000;
export const BUG_REPORT_EMAIL_MAX_LENGTH = 320;

export type BugReportStatus = "active" | "archived";

export interface BugReportPayload {
  title: string;
  description: string;
  email?: string;
  code?: string;
  preamble?: string;
  pageUrl?: string;
  userAgent?: string;
  previewImageDataUrl?: string;
  interfaceImageDataUrl?: string;
  sessionSnapshot?: string;
}

export interface StoredBugReport {
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
  sessionSnapshot: string;
  previewImageStorageKey: string | null;
  previewImageContentType: string | null;
  interfaceImageStorageKey: string | null;
  interfaceImageContentType: string | null;
  storage: "blob" | "file";
  storageKey: string;
}

export interface BugReportSuccess {
  success: true;
  id: string;
  submittedAt: string;
}

export interface BugReportFailure {
  success: false;
  error: string;
}

export type BugReportResponse = BugReportSuccess | BugReportFailure;

export interface BugReportListSuccess {
  success: true;
  reports: StoredBugReport[];
}

export type BugReportListResponse = BugReportListSuccess | BugReportFailure;

export interface BugReportArchiveSuccess {
  success: true;
  report: StoredBugReport;
}

export type BugReportArchiveResponse = BugReportArchiveSuccess | BugReportFailure;