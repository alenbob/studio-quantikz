import { describe, expect, it } from "vitest";
import { buildClipboard, canPasteClipboardAt, instantiateClipboardItems } from "../src/renderer/clipboard";
import type { CircuitItem, EditorState } from "../src/renderer/types";

function makeState(overrides: Partial<EditorState> = {}): EditorState {
  return {
    qubits: 4,
    steps: 6,
    layout: { rowSepCm: 0.9, columnSepCm: 0.7 },
    items: [],
    wireMask: {},
    horizontalSegmentsUnlocked: false,
    wireLabels: Array.from({ length: 4 }, () => ({ left: "", right: "" })),
    selectedItemIds: [],
    activeTool: "select",
    exportCode: "",
    exportIssues: [],
    uiMessage: null,
    ...overrides
  };
}

describe("clipboard helpers", () => {
  it("stores relative offsets and recreates the group at a new anchor", () => {
    const items: CircuitItem[] = [
      {
        id: "gate-1",
        type: "gate",
        point: { row: 0, col: 1 },
        span: { rows: 1, cols: 1 },
        label: "H",
        width: 40
      },
      {
        id: "line-1",
        type: "verticalConnector",
        point: { row: 0, col: 2 },
        length: 1
      },
      {
        id: "dot-1",
        type: "controlDot",
        point: { row: 0, col: 2 }
      },
      {
        id: "plus-1",
        type: "targetPlus",
        point: { row: 1, col: 2 }
      }
    ];

    const clipboard = buildClipboard(items);
    expect(clipboard).not.toBeNull();

    const pastedItems = instantiateClipboardItems(clipboard!, { row: 2, col: 3 });
    expect(pastedItems[0].point).toEqual({ row: 2, col: 3 });
    expect(pastedItems[1].point).toEqual({ row: 2, col: 4 });
    expect(pastedItems[3].point).toEqual({ row: 3, col: 4 });
  });

  it("rejects pasting a copied group outside the circuit bounds", () => {
    const clipboard = buildClipboard([
      {
        id: "gate-1",
        type: "gate",
        point: { row: 0, col: 0 },
        span: { rows: 2, cols: 1 },
        label: "U",
        width: 40
      }
    ]);

    expect(clipboard).not.toBeNull();
    expect(canPasteClipboardAt(makeState(), clipboard!, { row: 3, col: 5 })).toBe(false);
    expect(canPasteClipboardAt(makeState(), clipboard!, { row: 2, col: 4 })).toBe(true);
  });
});
