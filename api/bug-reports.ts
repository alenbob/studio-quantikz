import { listBugReports, readBugReportImage, validateBugReportAdminToken } from "../src/server/bugReports.js";
import type { BugReportListResponse } from "../src/shared/bugReport.js";

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

function readAdminToken(request: any): string | null {
  const authorization = request.headers?.authorization;
  if (typeof authorization === "string" && authorization.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length).trim();
  }

  const directHeader = request.headers?.["x-bug-report-admin-token"];
  return typeof directHeader === "string" ? directHeader.trim() : null;
}

export default async function handler(request: any, response: any): Promise<void> {
  if (request.method !== "GET") {
    response.status(405).json({ success: false, error: "Method not allowed." } satisfies BugReportListResponse);
    return;
  }

  try {
    validateBugReportAdminToken(readAdminToken(request));
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
    const reports = await listBugReports(limit);
    response.status(200).json({ success: true, reports } satisfies BugReportListResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to list bug reports.";
    const statusCode = message === "Invalid bug report admin token."
      ? 401
      : /positive integer|required|configured/i.test(message)
        ? 400
        : 500;

    response.status(statusCode).json({ success: false, error: message } satisfies BugReportListResponse);
  }
}