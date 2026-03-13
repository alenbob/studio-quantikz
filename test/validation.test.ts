import { describe, expect, it } from "vitest";
import { validateCircuit } from "../src/renderer/validation";
import type { EditorState } from "../src/renderer/types";
import { editorReducer, initialState } from "../src/renderer/reducer";

function makeState(overrides: Partial<EditorState>): EditorState {
  return {
    qubits: 3,
    steps: 4,
    layout: { rowSepCm: 0.9, columnSepCm: 0.7 },
    items: [],
    wireMask: {},
    wireLabels: Array.from({ length: 3 }, () => ({ left: "", right: "" })),
    selectedItemIds: [],
    activeTool: "select",
    exportCode: "",
    exportIssues: [],
    uiMessage: null,
    ...overrides
  };
}

describe("validateCircuit", () => {
  it("reports overlapping anchors", () => {
    const issues = validateCircuit(
      makeState({
        items: [
          {
            id: "gate-1",
            type: "gate",
            point: { row: 0, col: 0 },
            span: { rows: 1, cols: 1 },
            label: "U",
            width: 40
          },
          { id: "dot-1", type: "controlDot", point: { row: 0, col: 0 } }
        ]
      })
    );

    expect(issues.some((entry) => entry.message.includes("share a cell"))).toBe(true);
  });

  it("rejects grid shrink when items would fall outside bounds", () => {
    const state = {
      ...initialState,
      qubits: 3,
      steps: 4,
      items: [
        {
          id: "gate-1",
          type: "gate" as const,
          point: { row: 2, col: 3 },
          span: { rows: 1, cols: 1 },
          label: "U",
          width: 40
        }
      ]
    };

    const next = editorReducer(state, {
      type: "resizeGrid",
      dimension: "steps",
      value: 3
    });

    expect(next.steps).toBe(4);
    expect(next.uiMessage).toContain("Cannot reduce steps");
  });

  it("reports an invalid swap pair", () => {
    const issues = validateCircuit(
      makeState({
        items: [
          { id: "swap-1", type: "swapX", point: { row: 0, col: 1 } },
          { id: "line-1", type: "verticalConnector", point: { row: 0, col: 1 }, length: 2 }
        ]
      })
    );

    expect(issues.some((entry) => entry.message.includes("swap"))).toBe(true);
  });

  it("reports malformed gate labels before export", () => {
    const issues = validateCircuit(
      makeState({
        items: [
          {
            id: "gate-1",
            type: "gate",
            point: { row: 0, col: 0 },
            span: { rows: 1, cols: 1 },
            label: "$\\frac{1}{2",
            width: 64
          }
        ]
      })
    );

    expect(issues.some((entry) => entry.message.includes("unmatched $"))).toBe(true);
    expect(issues.some((entry) => entry.message.includes("unbalanced braces"))).toBe(true);
  });
});
