import { beforeEach, describe, expect, it, vi } from "vitest";

const { getLocalSvgRuntimeStatusMock, renderQuantikzSvgMock } = vi.hoisted(() => ({
  getLocalSvgRuntimeStatusMock: vi.fn(),
  renderQuantikzSvgMock: vi.fn()
}));

vi.mock("../src/server/renderQuantikz.js", () => ({
  getLocalSvgRuntimeStatus: getLocalSvgRuntimeStatusMock,
  renderQuantikzSvg: renderQuantikzSvgMock
}));

import handler from "../api/render-svg";

describe("render-svg api", () => {
  beforeEach(() => {
    getLocalSvgRuntimeStatusMock.mockReset();
    renderQuantikzSvgMock.mockReset();
  });

  it("returns local svg runtime status on GET", async () => {
    getLocalSvgRuntimeStatusMock.mockResolvedValue({
      enabled: true,
      message: "SVG enabled: local Python converter detected."
    });

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

    expect(responseState.statusCode).toBe(200);
    expect(responseState.payload).toMatchObject({
      success: true,
      localSvgEnabled: true,
      message: "SVG enabled: local Python converter detected."
    });
  });

  it("returns svg output from the renderer", async () => {
    renderQuantikzSvgMock.mockResolvedValue({
      success: true,
      svg: "<svg><path d='M0 0L1 1'/></svg>"
    });

    const request = {
      method: "POST",
      body: JSON.stringify({
        code: String.raw`\begin{tikzpicture}
\draw (0,0) circle (1);
\end{tikzpicture}`,
        preamble: "\\documentclass[tikz]{standalone}"
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

    expect(responseState.statusCode).toBe(200);
    expect(responseState.payload).toMatchObject({ success: true, svg: expect.stringContaining("<svg") });
  });

  it("propagates renderer failures and status codes", async () => {
    renderQuantikzSvgMock.mockResolvedValue({
      success: false,
      statusCode: 503,
      error: "pdftocairo unavailable"
    });

    const request = {
      method: "POST",
      body: JSON.stringify({
        code: String.raw`\begin{quantikz}\gate{H}\end{quantikz}`,
        preamble: "\\documentclass[tikz]{standalone}"
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

    expect(responseState.statusCode).toBe(503);
    expect(responseState.payload).toMatchObject({ success: false, error: "pdftocairo unavailable" });
  });
});
