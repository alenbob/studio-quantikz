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
    wireTypes: Array.from({ length: 3 }, () => "quantum"),
    autoWireNewGrid: true,
    horizontalSegmentsUnlocked: false,
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

  it("allows grid shrink and removes objects that no longer fit", () => {
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

    expect(next.steps).toBe(3);
    expect(next.items.some((item) => item.id === "gate-1")).toBe(false);
    expect(next.uiMessage).toContain("removed 1 out-of-bounds object");
  });

  it("reports an invalid swap pair", () => {
    const issues = validateCircuit(
      makeState({
        items: [
          { id: "swap-1", type: "swapX", point: { row: 0, col: 1 } },
          { id: "line-1", type: "verticalConnector", point: { row: 0, col: 1 }, length: 2, wireType: "quantum" }
        ]
      })
    );

    expect(issues.some((entry) => entry.message.includes("swap"))).toBe(true);
  });

  it("allows controlled swaps when the same connected wire contains one swap pair", () => {
    const issues = validateCircuit(
      makeState({
        qubits: 4,
        items: [
          { id: "ctrl-1", type: "controlDot", point: { row: 0, col: 1 } },
          { id: "swap-1", type: "swapX", point: { row: 1, col: 1 } },
          { id: "swap-2", type: "swapX", point: { row: 3, col: 1 } },
          { id: "line-1", type: "verticalConnector", point: { row: 0, col: 1 }, length: 1, wireType: "quantum" },
          { id: "line-2", type: "verticalConnector", point: { row: 1, col: 1 }, length: 2, wireType: "quantum" }
        ],
        wireTypes: Array.from({ length: 4 }, () => "quantum"),
        wireLabels: Array.from({ length: 4 }, () => ({ left: "", right: "" }))
      })
    );

    expect(issues.some((entry) => entry.message.includes("swap"))).toBe(false);
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

  it("allows consecutive connector pieces in one column so stacked controls can export", () => {
    const issues = validateCircuit(
      makeState({
        items: [
          { id: "dot-1", type: "controlDot", point: { row: 0, col: 1 } },
          { id: "dot-2", type: "controlDot", point: { row: 1, col: 1 } },
          { id: "line-1", type: "verticalConnector", point: { row: 0, col: 1 }, length: 1, wireType: "quantum" },
          { id: "line-2", type: "verticalConnector", point: { row: 1, col: 1 }, length: 1, wireType: "quantum" },
          { id: "plus-1", type: "targetPlus", point: { row: 2, col: 1 } }
        ]
      })
    );

    expect(issues).toEqual([]);
  });
});
