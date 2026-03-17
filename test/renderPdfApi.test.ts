import { beforeEach, describe, expect, it, vi } from "vitest";

const { renderQuantikzPdfMock } = vi.hoisted(() => ({
  renderQuantikzPdfMock: vi.fn()
}));

vi.mock("../src/server/renderQuantikz.js", () => ({
  renderQuantikzPdf: renderQuantikzPdfMock
}));

import handler from "../api/render-pdf";

describe("render-pdf api", () => {
  beforeEach(() => {
    renderQuantikzPdfMock.mockReset();
  });

  it("returns compiled pdf bytes from the isolated api route", async () => {
    const pdf = Buffer.from("%PDF-1.7\n", "utf8");
    renderQuantikzPdfMock.mockResolvedValue({ success: true, pdf });

    const request = {
      method: "POST",
      body: JSON.stringify({
        code: String.raw`\begin{quantikz}\gate{H}\end{quantikz}`,
        preamble: String.raw`\documentclass[tikz]{standalone}\n\usetikzlibrary{quantikz2}\n\usepackage{amsmath}\n\usepackage{amssymb}\n\usepackage{amsfonts}\n\usepackage{braket}`
      }),
      on: () => request
    };

    const responseState: {
      statusCode?: number;
      headers: Record<string, string>;
      payload?: Buffer | unknown;
    } = { headers: {} };

    const response = {
      setHeader(name: string, value: string) {
        responseState.headers[name] = value;
        return this;
      },
      status(code: number) {
        responseState.statusCode = code;
        return this;
      },
      json(payload: unknown) {
        responseState.payload = payload;
        return this;
      },
      send(payload: Buffer) {
        responseState.payload = payload;
        return this;
      }
    };

    await handler(request, response);

    expect(renderQuantikzPdfMock).toHaveBeenCalledTimes(1);
    expect(responseState.statusCode).toBe(200);
    expect(responseState.headers["Content-Type"]).toBe("application/pdf");
    expect(responseState.payload).toBe(pdf);
  });

  it("propagates renderer status codes on failure", async () => {
    renderQuantikzPdfMock.mockResolvedValue({
      success: false,
      statusCode: 503,
      error: "Compiler unavailable"
    });

    const request = {
      method: "POST",
      body: JSON.stringify({ code: "x", preamble: "y" }),
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

    expect(responseState.statusCode).toBe(503);
    expect(responseState.payload).toMatchObject({
      success: false,
      error: "Compiler unavailable"
    });
  });
});