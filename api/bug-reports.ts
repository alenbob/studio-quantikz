import { handleCors } from "./_cors.js";
import { archiveBugReport, listBugReports, readBugReportImage, validateBugReportAdminToken } from "../src/server/bugReports.js";
import type { BugReportArchiveResponse, BugReportListResponse, BugReportStatus } from "../src/shared/bugReport.js";

async function readRequestBody(request: { body?: unknown; on: (event: string, cb: (chunk: Buffer | string) => void) => void }): Promise<string> {
  if (typeof request.body === "string") {
    return request.body;
  }

  if (request.body && typeof request.body === "object") {
    return JSON.stringify(request.body);
  }

  return new Promise((resolve, reject) => {
    let data = "";

    request.on("data", (chunk) => {
      data += chunk.toString();
    });

    request.on("end", () => resolve(data));
    request.on("error", reject);
  });
}

function parseLimit(value: unknown): number {
  if (typeof value !== "string" || !value.trim()) {
    return 50;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("The bug report limit must be a positive integer.");
  }

  return Math.min(parsed, 200);
}

function parseStatus(value: unknown): BugReportStatus {
  return value === "archived" ? "archived" : "active";
}

function readAdminToken(request: any): string | null {
  const authorization = request.headers?.authorization;
  if (typeof authorization === "string" && authorization.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length).trim();
  }

  const directHeader = request.headers?.["x-bug-report-admin-token"];
  return typeof directHeader === "string" ? directHeader.trim() : null;
}

export default async function handler(request: any, response: any): Promise<void> {
  if (handleCors(request, response)) {
    return;
  }

  if (request.method !== "GET" && request.method !== "POST") {
    response.status(405).json({ success: false, error: "Method not allowed." } satisfies BugReportListResponse);
    return;
  }

  try {
    validateBugReportAdminToken(readAdminToken(request));
    if (request.method === "POST") {
      const rawBody = await readRequestBody(request);
      const payload = rawBody ? JSON.parse(rawBody) : {};
      if (payload?.action !== "archive" || typeof payload.storageKey !== "string") {
        throw new Error("Archive requests require action=archive and a storageKey.");
      }

      const report = await archiveBugReport(payload.storageKey);
      response.status(200).json({ success: true, report } satisfies BugReportArchiveResponse);
      return;
    }

    if (request.query?.storageKey) {
      const image = await readBugReportImage(String(request.query.storageKey));
      if (!image) {
        response.status(404).end("Not found.");
        return;
      }

      response.status(200);
      response.setHeader("Content-Type", image.contentType);
      response.setHeader("Cache-Control", "private, max-age=60");
      response.send(image.body);
      return;
    }

    const limit = parseLimit(request.query?.limit);
    const reports = await listBugReports(limit, parseStatus(request.query?.status));
    response.status(200).json({ success: true, reports } satisfies BugReportListResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to list bug reports.";
    const statusCode = message === "Invalid bug report admin token."
      ? 401
      : /positive integer|required|configured|action=archive/i.test(message)
        ? 400
        : /not found/i.test(message)
          ? 404
        : 500;

    response.status(statusCode).json({ success: false, error: message } satisfies BugReportListResponse);
  }
}