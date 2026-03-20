import { describe, expect, it } from "vitest";
import { renderMathExpressionHtml } from "../src/renderer/tex";

describe("renderMathExpressionHtml", () => {
  it("renders preamble-defined macros for the visual editor", () => {
    const html = renderMathExpressionHtml("\\rixs", {
      "\\rixs": "\\mathrm{RIXS}"
    });

    expect(html).toContain("RIXS");
  });
});