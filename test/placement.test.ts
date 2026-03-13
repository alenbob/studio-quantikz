import { describe, expect, it } from "vitest";
import { placementFromViewportPoint } from "../src/renderer/placement";
import type { BoardMetrics, EditorState } from "../src/renderer/types";

const baseState: EditorState = {
  qubits: 3,
  steps: 5,
  layout: { rowSepCm: 0.9, columnSepCm: 0.7 },
  items: [],
  wireMask: {},
  wireLabels: Array.from({ length: 3 }, () => ({ left: "", right: "" })),
  selectedItemIds: [],
  activeTool: "select",
  exportCode: "",
  exportIssues: [],
  uiMessage: null
};

function createMetrics(overrides: Partial<BoardMetrics> = {}): BoardMetrics {
  return {
    left: 100,
    top: 200,
    width: 480,
    height: 320,
    scrollLeft: 0,
    scrollTop: 0,
    ...overrides
  };
}

describe("placementFromViewportPoint", () => {
  it("maps viewport coordinates to a cell when the board is not scrolled", () => {
    const placement = placementFromViewportPoint(310, 272, createMetrics(), "gate", baseState);

    expect(placement).toEqual({ kind: "cell", row: 0, col: 0 });
  });

  it("accounts for board scrolling when resolving a dragged item", () => {
    const placement = placementFromViewportPoint(
      310,
      272,
      createMetrics({ scrollLeft: 216, scrollTop: 112 }),
      "gate",
      baseState
    );

    expect(placement).toEqual({ kind: "cell", row: 2, col: 3 });
  });

  it("returns null when the pointer is outside the visible board", () => {
    const placement = placementFromViewportPoint(80, 272, createMetrics(), "gate", baseState);

    expect(placement).toBeNull();
  });

  it("does not target the last wire for a vertical connector", () => {
    const placement = placementFromViewportPoint(190, 384, createMetrics(), "verticalConnector", baseState);

    expect(placement).toBeNull();
  });
});
