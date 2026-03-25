import { beforeEach, describe, expect, it, vi } from "vitest";

const { archiveBugReportMock, listBugReportsMock, readBugReportImageMock, validateBugReportAdminTokenMock } = vi.hoisted(() => ({
  archiveBugReportMock: vi.fn(),
  listBugReportsMock: vi.fn(),
  readBugReportImageMock: vi.fn(),
  validateBugReportAdminTokenMock: vi.fn()
}));

vi.mock("../src/server/bugReports.js", () => ({
  archiveBugReport: archiveBugReportMock,
  listBugReports: listBugReportsMock,
  readBugReportImage: readBugReportImageMock,
  validateBugReportAdminToken: validateBugReportAdminTokenMock
}));

import handler from "../api/bug-reports";

describe("bug-reports api", () => {
  beforeEach(() => {
    archiveBugReportMock.mockReset();
    listBugReportsMock.mockReset();
    readBugReportImageMock.mockReset();
    validateBugReportAdminTokenMock.mockReset();
  });

  it("lists bug reports when the admin token is valid", async () => {
    listBugReportsMock.mockResolvedValue([
      {
        id: "bug-123",
        submittedAt: "2026-03-25T12:00:00.000Z",
        status: "active",
        archivedAt: null,
        title: "Preview clipped",
        description: "Bottom wire disappears.",
        email: null,
        code: "\\begin{quantikz}",
        preamble: "",
        pageUrl: null,
        userAgent: null,
        sessionSnapshot: "",
        previewImageStorageKey: "bug-report-images/2026-03-25-bug-123.png",
        previewImageContentType: "image/png",
        interfaceImageStorageKey: null,
        interfaceImageContentType: null,
        storage: "blob",
        storageKey: "bug-reports/2026-03-25-bug-123.json"
      }
    ]);

    const request = {
      method: "GET",
      query: { limit: "25" },
      headers: {
        authorization: "Bearer secret-token"
      }
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

    expect(validateBugReportAdminTokenMock).toHaveBeenCalledWith("secret-token");
    expect(listBugReportsMock).toHaveBeenCalledWith(25, "active");
    expect(responseState.statusCode).toBe(200);
    expect(responseState.payload).toEqual({
      success: true,
      reports: expect.any(Array)
    });
  });

  it("streams a preview image when the admin token is valid", async () => {
    readBugReportImageMock.mockResolvedValue({
      contentType: "image/png",
      body: Buffer.from("image-bytes")
    });

    const request = {
      method: "GET",
      query: { storageKey: "bug-report-images/2026-03-25-bug-123.png" },
      headers: {
        authorization: "Bearer secret-token"
      }
    };

    const responseState: { statusCode?: number; body?: Buffer; headers?: Record<string, string> } = {};
    const response = {
      status(code: number) {
        responseState.statusCode = code;
        return this;
      },
      setHeader(name: string, value: string) {
        responseState.headers ??= {};
        responseState.headers[name] = value;
        return this;
      },
      send(payload: Buffer) {
        responseState.body = payload;
        return this;
      }
    };

    await handler(request, response);

    expect(validateBugReportAdminTokenMock).toHaveBeenCalledWith("secret-token");
    expect(readBugReportImageMock).toHaveBeenCalledWith("bug-report-images/2026-03-25-bug-123.png");
    expect(responseState.statusCode).toBe(200);
    expect(responseState.headers).toEqual(expect.objectContaining({
      "Content-Type": "image/png",
      "Cache-Control": "private, max-age=60"
    }));
    expect(responseState.body).toEqual(Buffer.from("image-bytes"));
  });

  it("lists archived bug reports when requested", async () => {
    listBugReportsMock.mockResolvedValue([]);

    const request = {
      method: "GET",
      query: { limit: "10", status: "archived" },
      headers: {
        authorization: "Bearer secret-token"
      }
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

    expect(listBugReportsMock).toHaveBeenCalledWith(10, "archived");
    expect(responseState.statusCode).toBe(200);
  });

  it("archives a bug report when requested", async () => {
    archiveBugReportMock.mockResolvedValue({
      id: "bug-123",
      submittedAt: "2026-03-25T12:00:00.000Z",
      status: "archived",
      archivedAt: "2026-03-25T13:00:00.000Z",
      title: "Preview clipped",
      description: "Bottom wire disappears.",
      email: null,
      code: "",
      preamble: "",
      pageUrl: null,
      userAgent: null,
      sessionSnapshot: "",
      previewImageStorageKey: null,
      previewImageContentType: null,
      interfaceImageStorageKey: null,
      interfaceImageContentType: null,
      storage: "blob",
      storageKey: "bug-reports/2026-03-25-bug-123.json"
    });

    const request = {
      method: "POST",
      body: JSON.stringify({
        action: "archive",
        storageKey: "bug-reports/2026-03-25-bug-123.json"
      }),
      headers: {
        authorization: "Bearer secret-token"
      },
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

    expect(validateBugReportAdminTokenMock).toHaveBeenCalledWith("secret-token");
    expect(archiveBugReportMock).toHaveBeenCalledWith("bug-reports/2026-03-25-bug-123.json");
    expect(responseState.statusCode).toBe(200);
    expect(responseState.payload).toEqual({
      success: true,
      report: expect.objectContaining({ status: "archived" })
    });
  });

  it("rejects invalid admin tokens", async () => {
    validateBugReportAdminTokenMock.mockImplementation(() => {
      throw new Error("Invalid bug report admin token.");
    });

    const request = {
      method: "GET",
      query: {},
      headers: {}
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

    expect(responseState.statusCode).toBe(401);
    expect(responseState.payload).toEqual({
      success: false,
      error: "Invalid bug report admin token."
    });
  });

  it("rejects unsupported methods", async () => {
    const request = {
      method: "PATCH",
      query: {},
      headers: {}
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

    expect(responseState.statusCode).toBe(405);
    expect(responseState.payload).toEqual({
      success: false,
      error: "Method not allowed."
    });
  });
});