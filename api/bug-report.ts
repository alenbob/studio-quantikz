import { handleCors } from "./_cors.js";
import { storeBugReport } from "../src/server/bugReports.js";
import type { BugReportPayload, BugReportResponse } from "../src/shared/bugReport.js";

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

export default async function handler(request: any, response: any): Promise<void> {
  if (handleCors(request, response)) {
    return;
  }

  if (request.method !== "POST") {
    response.status(405).json({ success: false, error: "Method not allowed." } satisfies BugReportResponse);
    return;
  }

  try {
    const rawBody = await readRequestBody(request);
    const payload = (rawBody ? JSON.parse(rawBody) : {}) as BugReportPayload;
    const report = await storeBugReport(payload);

    response.status(200).json({
      success: true,
      id: report.id,
      submittedAt: report.submittedAt
    } satisfies BugReportResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to submit bug report.";
    const statusCode = /required\./i.test(message) ? 400 : 500;

    response.status(statusCode).json({
      success: false,
      error: message
    } satisfies BugReportResponse);
  }
}