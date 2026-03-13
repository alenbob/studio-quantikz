import { describe, expect, it } from "vitest";
import { findWireLabelGroupStart, getWireLabelGroup, normalizeWireLabels } from "../src/renderer/wireLabels";
import type { WireLabel } from "../src/renderer/types";

describe("wireLabels", () => {
  it("resolves merged rows back to the top group start", () => {
    const labels: WireLabel[] = normalizeWireLabels(
      [
        { left: "\\ket{0}", right: "", leftSpan: 2, leftBracket: "paren" },
        { left: "", right: "" },
        { left: "", right: "" }
      ],
      3
    );

    expect(findWireLabelGroupStart(labels, 1, "left")).toBe(0);
    expect(getWireLabelGroup(labels, 1, "left")).toMatchObject({
      row: 0,
      span: 2,
      text: "\\ket{0}",
      bracket: "paren"
    });
  });
});
