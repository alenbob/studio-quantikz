import { describe, expect, it } from "vitest";
import { buildClipboard } from "../src/renderer/clipboard";
import { editorReducer, initialState } from "../src/renderer/reducer";

describe("editorReducer selection workflows", () => {
  it("pastes a copied group and selects the pasted items", () => {
    const state = {
      ...initialState,
      qubits: 4,
      steps: 6,
      items: [
        {
          id: "gate-1",
          type: "gate" as const,
          point: { row: 0, col: 0 },
          span: { rows: 1, cols: 1 },
          label: "H",
          width: 40
        },
        {
          id: "gate-2",
          type: "gate" as const,
          point: { row: 0, col: 1 },
          span: { rows: 1, cols: 1 },
          label: "X",
          width: 40
        }
      ],
      selectedItemIds: ["gate-1", "gate-2"]
    };

    const clipboard = buildClipboard(state.items);
    expect(clipboard).not.toBeNull();

    const next = editorReducer(state, {
      type: "pasteClipboard",
      clipboard: clipboard!,
      anchor: { row: 2, col: 3 }
    });

    expect(next.items).toHaveLength(4);
    expect(next.selectedItemIds).toHaveLength(2);
    expect(next.selectedItemIds.every((itemId) => itemId.startsWith("gate-"))).toBe(true);
    expect(next.items.filter((item) => item.point.row === 2)).toHaveLength(2);
    expect(next.items.some((item) => item.point.col === 4)).toBe(true);
  });

  it("deletes all currently selected items", () => {
    const state = {
      ...initialState,
      items: [
        {
          id: "gate-1",
          type: "gate" as const,
          point: { row: 0, col: 0 },
          span: { rows: 1, cols: 1 },
          label: "H",
          width: 40
        },
        { id: "dot-1", type: "controlDot" as const, point: { row: 1, col: 0 } },
        { id: "swap-1", type: "swapX" as const, point: { row: 2, col: 0 } }
      ],
      selectedItemIds: ["gate-1", "dot-1"]
    };

    const next = editorReducer(state, { type: "deleteSelected" });

    expect(next.items).toEqual([{ id: "swap-1", type: "swapX", point: { row: 2, col: 0 } }]);
    expect(next.selectedItemIds).toEqual([]);
  });
});
