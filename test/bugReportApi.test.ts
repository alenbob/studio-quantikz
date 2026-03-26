import { beforeEach, describe, expect, it, vi } from "vitest";

const { storeBugReportMock } = vi.hoisted(() => ({
  storeBugReportMock: vi.fn()
}));

vi.mock("../src/server/bugReports.js", () => ({
  storeBugReport: storeBugReportMock
}));

import handler from "../api/bug-report";

describe("bug-report api", () => {
  beforeEach(() => {
    storeBugReportMock.mockReset();
  });

  it("stores a submitted bug report", async () => {
    storeBugReportMock.mockResolvedValue({
      id: "bug-123",
      submittedAt: "2026-03-25T12:00:00.000Z"
    });

    const request = {
      method: "POST",
      body: JSON.stringify({
        title: "Preview clipped",
        description: "The preview pane clips long circuits.",
        previewImageDataUrl: "data:image/png;base64,QUJD",
        visualCircuitSnapshot: JSON.stringify({ summary: { qubits: 3, steps: 4 } })
      }),
      on: () => request
    };

    const responseState: { statusCode?: number; payload?: unknown } = {};
    const response = {
      status(code: number) {
        responseState.statusCode = code;
        return this;
      },
      json(payload: unknown) {
        responseState.payload = payload;
        return this;
      }
    };

    await handler(request, response);

    expect(storeBugReportMock).toHaveBeenCalledWith(expect.objectContaining({
      title: "Preview clipped",
      description: "The preview pane clips long circuits.",
      previewImageDataUrl: "data:image/png;base64,QUJD",
      visualCircuitSnapshot: JSON.stringify({ summary: { qubits: 3, steps: 4 } })
    }));
    expect(responseState.statusCode).toBe(200);
    expect(responseState.payload).toEqual({
      success: true,
      id: "bug-123",
      submittedAt: "2026-03-25T12:00:00.000Z"
    });
  });

  it("returns validation failures as bad requests", async () => {
    storeBugReportMock.mockRejectedValue(new Error("Title is required."));

    const request = {
      method: "POST",
      body: JSON.stringify({ description: "Missing title" }),
      on: () => request
    };

    const responseState: { statusCode?: number; payload?: unknown } = {};
    const response = {
      status(code: number) {
        responseState.statusCode = code;
        return this;
      },
      json(payload: unknown) {
        responseState.payload = payload;
        return this;
      }
    };

    await handler(request, response);

    expect(responseState.statusCode).toBe(400);
    expect(responseState.payload).toEqual({
      success: false,
      error: "Title is required."
    });
  });

  it("rejects unsupported methods", async () => {
    const request = {
      method: "GET",
      on: () => request
    };

    const responseState: { statusCode?: number; payload?: unknown } = {};
    const response = {
      status(code: number) {
        responseState.statusCode = code;
        return this;
      },
      json(payload: unknown) {
        responseState.payload = payload;
        return this;
      }
    };

    await handler(request, response);

    expect(storeBugReportMock).not.toHaveBeenCalled();
    expect(responseState.statusCode).toBe(405);
    expect(responseState.payload).toEqual({
      success: false,
      error: "Method not allowed."
    });
  });
});