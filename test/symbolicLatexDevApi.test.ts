import { beforeEach, describe, expect, it, vi } from "vitest";

const { renderSymbolicLatexMock } = vi.hoisted(() => ({
  renderSymbolicLatexMock: vi.fn()
}));

vi.mock("../src/server/renderSymbolicLatex.js", () => ({
  renderSymbolicLatex: renderSymbolicLatexMock
}));

import handler from "../api/symbolic-latex-dev";

describe("symbolic-latex-dev api", () => {
  beforeEach(() => {
    renderSymbolicLatexMock.mockReset();
  });

  it("returns generated symbolic latex from the node bridge", async () => {
    renderSymbolicLatexMock.mockResolvedValue({
      success: true,
      envIndex: 0,
      latex: String.raw`\begin{align*}\ket{\Psi_{0}}\end{align*}`
    });

    const request = {
      method: "POST",
      body: JSON.stringify({
        code: String.raw`\begin{quantikz}\lstick{$\ket{0}$}\end{quantikz}`,
        envIndex: 0
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

    expect(renderSymbolicLatexMock).toHaveBeenCalledWith(
      expect.stringContaining(String.raw`\begin{quantikz}`),
      0
    );
    expect(responseState.statusCode).toBe(200);
    expect(responseState.payload).toMatchObject({
      success: true,
      latex: expect.stringContaining(String.raw`\begin{align*}`)
    });
  });
});
