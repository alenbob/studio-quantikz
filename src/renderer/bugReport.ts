import type { BugReportPayload, BugReportResponse } from "../shared/bugReport";

function parseBugReportResponse(body: string): BugReportResponse | null {
  try {
    return JSON.parse(body) as BugReportResponse;
  } catch {
    return null;
  }
}

export async function submitBugReport(payload: BugReportPayload): Promise<BugReportResponse & { success: true }> {
  const response = await fetch("/api/bug-report", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const body = await response.text();
  const parsed = parseBugReportResponse(body);

  if (!parsed) {
    throw new Error(response.ok ? "Unable to submit bug report." : body.trim() || "Unable to submit bug report.");
  }

  if (!response.ok || !parsed.success) {
    throw new Error(parsed.error);
  }

  return parsed;
}