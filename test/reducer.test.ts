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
        ...initialState.items.filter((item) => item.type === "horizontalSegment"),
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

    const clipboard = buildClipboard(state.items.filter((item) => item.type === "gate"));
    expect(clipboard).not.toBeNull();

    const next = editorReducer(state, {
      type: "pasteClipboard",
      clipboard: clipboard!,
      anchor: { row: 2, col: 3 }
    });

    const gates = next.items.filter((item) => item.type === "gate");
    expect(gates).toHaveLength(4);
    expect(next.selectedItemIds).toHaveLength(2);
    expect(next.items.some((item) => item.type === "gate" && item.point.row === 2 && item.point.col === 3)).toBe(true);
    expect(next.items.some((item) => item.type === "gate" && item.point.row === 2 && item.point.col === 4)).toBe(true);
  });

  it("materializes and selects an implicit horizontal wire segment", () => {
    const next = editorReducer(initialState, {
      type: "selectOrCreateHorizontalSegment",
      row: 1,
      col: 2
    });

    expect(next.items).toContainEqual({
      id: expect.any(String),
      type: "horizontalSegment",
      point: { row: 1, col: 2 },
      mode: "present",
      wireType: "quantum",
      color: null
    });
    expect(next.selectedItemIds).toHaveLength(1);
    expect(next.wireMask["1:2"]).toBe("present");
  });

  it("creates a multi-row and multi-column gate from a dragged area", () => {
    const next = editorReducer(initialState, {
      type: "addGateFromArea",
      start: { row: 0, col: 0 },
      end: { row: 1, col: 2 }
    });

    expect(next.items).toContainEqual({
      id: expect.any(String),
      type: "gate",
      point: { row: 0, col: 0 },
      span: { rows: 2, cols: 3 },
      label: "U",
      width: 40,
      color: null
    });
  });

  it("creates a multi-row measurement from a dragged area", () => {
    const next = editorReducer(initialState, {
      type: "addMeterFromArea",
      start: { row: 0, col: 1 },
      endRow: 2
    });

    expect(next.items).toContainEqual({
      id: expect.any(String),
      type: "meter",
      point: { row: 0, col: 1 },
      span: { rows: 3, cols: 1 },
      color: null
    });
  });

  it("creates a frame from a dragged annotation area and a slice from a click", () => {
    const frameState = editorReducer(initialState, {
      type: "addAnnotationFromArea",
      start: { row: 0, col: 1 },
      end: { row: 1, col: 2 }
    });

    expect(frameState.items).toContainEqual({
      id: expect.any(String),
      type: "frame",
      point: { row: 0, col: 1 },
      span: { rows: 2, cols: 2 },
      label: "Group",
      rounded: true,
      dashed: true,
      background: true,
      innerXSepPt: 2,
      color: null
    });

    const sliceState = editorReducer(initialState, {
      type: "addAnnotationFromArea",
      start: { row: 1, col: 2 },
      end: { row: 1, col: 2 }
    });

    expect(sliceState.items).toContainEqual({
      id: expect.any(String),
      type: "slice",
      point: { row: 1, col: 2 },
      label: "slice",
      color: null
    });
  });

  it("deletes all currently selected non-wire items", () => {
    const state = {
      ...initialState,
      items: [
        ...initialState.items,
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

    expect(next.items.some((item) => item.id === "gate-1")).toBe(false);
    expect(next.items.some((item) => item.id === "dot-1")).toBe(false);
    expect(next.items).toContainEqual({ id: "swap-1", type: "swapX", point: { row: 2, col: 0 } });
    expect(next.selectedItemIds).toEqual([]);
  });

  it("turns selected horizontal segments into absent overrides when deleting", () => {
    const state = {
      ...initialState,
      items: initialState.items.map((item) =>
        item.type === "horizontalSegment" && item.point.row === 0 && item.point.col === 0
          ? {
              ...item,
              id: "line-1",
              color: "#C85D2D" as const
            }
          : item
      ),
      selectedItemIds: ["line-1"]
    };

    const next = editorReducer(state, { type: "deleteSelected" });

    expect(next.selectedItemIds).toEqual([]);
    expect(next.items).toContainEqual({
      id: "line-1",
      type: "horizontalSegment",
      point: { row: 0, col: 0 },
      mode: "absent",
      wireType: "quantum",
      color: null
    });
    expect(next.wireMask["0:0"]).toBe("absent");
  });

  it("drops horizontal segments from the current selection when they are locked again", () => {
    const state = {
      ...initialState,
      horizontalSegmentsUnlocked: true,
      items: initialState.items.map((item) =>
        item.type === "horizontalSegment" && item.point.row === 0 && item.point.col === 0
          ? { ...item, id: "line-1", mode: "absent" as const }
          : item
      ).concat([
        {
          id: "gate-1",
          type: "gate" as const,
          point: { row: 0, col: 1 },
          span: { rows: 1, cols: 1 },
          label: "H",
          width: 40
        }
      ]),
      selectedItemIds: ["line-1", "gate-1"]
    };

    const next = editorReducer(state, {
      type: "setHorizontalSegmentsUnlocked",
      unlocked: false
    });

    expect(next.horizontalSegmentsUnlocked).toBe(false);
    expect(next.selectedItemIds).toEqual(["gate-1"]);
  });

  it("updates row-level wire types independently from item selection", () => {
    const next = editorReducer(initialState, {
      type: "updateRowWireType",
      row: 1,
      wireType: "classical"
    });

    expect(next.wireTypes).toEqual(["quantum", "classical", "quantum"]);
    expect(
      next.items.find(
        (item) => item.type === "horizontalSegment" && item.point.row === 1 && item.point.col === 0
      )
    ).toMatchObject({ wireType: "quantum" });
  });

  it("updates a control dot between filled and open states", () => {
    const state = {
      ...initialState,
      items: [
        ...initialState.items,
        { id: "dot-1", type: "controlDot" as const, point: { row: 0, col: 1 }, controlState: "filled" as const }
      ],
      selectedItemIds: ["dot-1"]
    };

    const next = editorReducer(state, {
      type: "updateControlState",
      itemId: "dot-1",
      controlState: "open"
    });

    expect(next.items).toContainEqual({
      id: "dot-1",
      type: "controlDot",
      point: { row: 0, col: 1 },
      controlState: "open"
    });
  });
});
