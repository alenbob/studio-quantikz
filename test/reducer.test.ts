import { describe, expect, it } from "vitest";
import { buildClipboard } from "../src/renderer/clipboard";
import { getMeterSuppressedHorizontalKeys } from "../src/renderer/horizontalWires";
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

  it("materializes and selects an implicit horizontal wire segment when wires are unlocked", () => {
    const next = editorReducer(
      {
        ...initialState,
        horizontalSegmentsUnlocked: true
      },
      {
      type: "selectOrCreateHorizontalSegment",
      row: 1,
      col: 2
      }
    );

    expect(next.items).toContainEqual(expect.objectContaining({
      id: expect.any(String),
      type: "horizontalSegment",
      point: { row: 1, col: 2 },
      mode: "present",
      wireType: "quantum",
      color: null
    }));
    expect(next.selectedItemIds).toHaveLength(1);
    expect(next.wireMask["1:2"]).toBe("present");
  });

  it("does not select a horizontal wire while wires are locked", () => {
    const next = editorReducer(initialState, {
      type: "selectOrCreateHorizontalSegment",
      row: 1,
      col: 2
    });

    expect(next.selectedItemIds).toEqual([]);
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

  it("draws a left half wire from the circuit boundary into the first column", () => {
    const state = editorReducer(
      {
        ...initialState,
        horizontalSegmentsUnlocked: true,
        selectedItemIds: ["horizontalSegment-1"]
      },
      { type: "deleteSelected" }
    );

    const next = editorReducer(state, {
      type: "drawWire",
      start: { row: 0, col: -1 },
      end: { row: 0, col: 0 }
    });

    expect(next.items.find((item) => item.type === "horizontalSegment" && item.point.row === 0 && item.point.col === 0)).toMatchObject({
      type: "horizontalSegment",
      point: { row: 0, col: 0 },
      mode: "present"
    });
  });

  it("anchors an equals column to the selected step regardless of the clicked row", () => {
    const next = editorReducer(initialState, {
      type: "addItem",
      tool: "equalsColumn",
      placement: { kind: "cell", row: 2, col: 3 }
    });

    expect(next.items).toContainEqual(expect.objectContaining({
      type: "equalsColumn",
      point: { row: 0, col: 3 },
      color: null
    }));
    expect(next.selectedItemIds).toHaveLength(1);
  });

  it("inserts a row and expands overlapping items while shifting lower anchors", () => {
    const state = {
      ...initialState,
      qubits: 3,
      steps: 4,
      items: [
        ...initialState.items.filter((item) => item.type === "horizontalSegment"),
        {
          id: "gate-1",
          type: "gate" as const,
          point: { row: 0, col: 1 },
          span: { rows: 2, cols: 1 },
          label: "U",
          width: 40
        },
        { id: "dot-1", type: "controlDot" as const, point: { row: 2, col: 3 } }
      ]
    };

    const next = editorReducer(state, {
      type: "insertGridLine",
      dimension: "qubits",
      index: 1
    });

    expect(next.qubits).toBe(4);
    expect(next.items).toContainEqual(expect.objectContaining({
      id: "gate-1",
      type: "gate",
      point: { row: 0, col: 1 },
      span: { rows: 3, cols: 1 }
    }));
    expect(next.items).toContainEqual(expect.objectContaining({
      id: "dot-1",
      type: "controlDot",
      point: { row: 3, col: 3 }
    }));
  });

  it("deletes a column, removing anchored items and shrinking overlapping spans", () => {
    const state = {
      ...initialState,
      qubits: 3,
      steps: 5,
      items: [
        ...initialState.items.filter((item) => item.type === "horizontalSegment"),
        {
          id: "gate-1",
          type: "gate" as const,
          point: { row: 0, col: 0 },
          span: { rows: 1, cols: 2 },
          label: "U",
          width: 40
        },
        { id: "dot-1", type: "controlDot" as const, point: { row: 1, col: 1 } },
        { id: "eq-1", type: "equalsColumn" as const, point: { row: 0, col: 3 } }
      ]
    };

    const next = editorReducer(state, {
      type: "deleteGridLine",
      dimension: "steps",
      index: 1
    });

    expect(next.steps).toBe(4);
    expect(next.items).toContainEqual(expect.objectContaining({
      id: "gate-1",
      type: "gate",
      point: { row: 0, col: 0 },
      span: { rows: 1, cols: 1 }
    }));
    expect(next.items.some((item) => item.id === "dot-1")).toBe(false);
    expect(next.items).toContainEqual(expect.objectContaining({
      id: "eq-1",
      type: "equalsColumn",
      point: { row: 0, col: 2 }
    }));
  });

  it("rejects placing a gate on top of an existing anchored object", () => {
    const state = {
      ...initialState,
      items: [
        ...initialState.items,
        { id: "dot-1", type: "controlDot" as const, point: { row: 0, col: 0 } }
      ]
    };

    const next = editorReducer(state, {
      type: "addItem",
      tool: "gate",
      placement: { kind: "cell", row: 0, col: 0 }
    });

    expect(next.items).toEqual(state.items);
    expect(next.uiMessage).toBe("Cannot place objects on top of each other.");
  });

  it("rejects moving a gate onto an occupied cell", () => {
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
        { id: "swap-1", type: "swapX" as const, point: { row: 0, col: 1 } }
      ]
    };

    const next = editorReducer(state, {
      type: "moveItem",
      itemId: "gate-1",
      placement: { kind: "cell", row: 0, col: 1 }
    });

    expect(next.items).toEqual(state.items);
    expect(next.uiMessage).toBe("Cannot place objects on top of each other.");
  });

  it("moves the current selection together by the anchor delta", () => {
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
        { id: "dot-1", type: "controlDot" as const, point: { row: 1, col: 1 } }
      ],
      selectedItemIds: ["gate-1", "dot-1"]
    };

    const next = editorReducer(state, {
      type: "moveSelection",
      anchorItemId: "gate-1",
      placement: { kind: "cell", row: 1, col: 2 }
    });

    expect(next.items).toContainEqual({
      id: "gate-1",
      type: "gate",
      point: { row: 1, col: 2 },
      span: { rows: 1, cols: 1 },
      label: "H",
      width: 40
    });
    expect(next.items).toContainEqual({ id: "dot-1", type: "controlDot", point: { row: 2, col: 3 } });
  });

  it("moves a selected horizontal segment to its new slot", () => {
    const state = {
      ...initialState,
      horizontalSegmentsUnlocked: true,
      selectedItemIds: ["horizontalSegment-2"]
    };

    const next = editorReducer(state, {
      type: "moveSelection",
      anchorItemId: "horizontalSegment-2",
      placement: { kind: "segment", row: 1, col: 3 }
    });

    expect(next.items.find((item) => item.id === "horizontalSegment-2")).toMatchObject({
      type: "horizontalSegment",
      point: { row: 1, col: 3 }
    });
    expect(next.items).toContainEqual(expect.objectContaining({
      type: "horizontalSegment",
      point: { row: 0, col: 1 },
      mode: "absent"
    }));
  });

  it("moves a horizontal segment with moveItem without losing it to normalization", () => {
    const next = editorReducer(
      {
        ...initialState,
        horizontalSegmentsUnlocked: true
      },
      {
        type: "moveItem",
        itemId: "horizontalSegment-2",
        placement: { kind: "segment", row: 1, col: 4 }
      }
    );

    expect(next.items.find((item) => item.id === "horizontalSegment-2")).toMatchObject({
      type: "horizontalSegment",
      point: { row: 1, col: 4 }
    });
    expect(next.items).toContainEqual(expect.objectContaining({
      type: "horizontalSegment",
      point: { row: 0, col: 1 },
      mode: "absent"
    }));
  });

  it("grows the grid when a dragged selection moves below or to the right", () => {
    const state = {
      ...initialState,
      items: [
        ...initialState.items,
        {
          id: "gate-1",
          type: "gate" as const,
          point: { row: 2, col: 4 },
          span: { rows: 1, cols: 1 },
          label: "H",
          width: 40
        }
      ],
      selectedItemIds: ["gate-1"]
    };

    const next = editorReducer(state, {
      type: "moveSelection",
      anchorItemId: "gate-1",
      placement: { kind: "cell", row: 3, col: 5 }
    });

    expect(next.qubits).toBe(4);
    expect(next.steps).toBe(6);
    expect(next.items).toContainEqual({
      id: "gate-1",
      type: "gate",
      point: { row: 3, col: 5 },
      span: { rows: 1, cols: 1 },
      label: "H",
      width: 40
    });
  });

  it("restricts external vertical-link drags to rows and extends the connector", () => {
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
        {
          id: "line-1",
          type: "verticalConnector" as const,
          point: { row: 0, col: 0 },
          length: 1,
          wireType: "quantum" as const,
          color: null
        }
      ],
      selectedItemIds: ["gate-1"]
    };

    const next = editorReducer(state, {
      type: "moveSelection",
      anchorItemId: "gate-1",
      placement: { kind: "cell", row: 2, col: 2 }
    });

    expect(next.items).toContainEqual({
      id: "gate-1",
      type: "gate",
      point: { row: 2, col: 0 },
      span: { rows: 1, cols: 1 },
      label: "H",
      width: 40
    });
    expect(next.items).toContainEqual({
      id: "line-1",
      type: "verticalConnector",
      point: { row: 1, col: 0 },
      length: 1,
      wireType: "quantum",
      color: null
    });
  });

  it("rejects expanding a gate span over an existing marker", () => {
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
        { id: "dot-1", type: "controlDot" as const, point: { row: 0, col: 1 } }
      ]
    };

    const next = editorReducer(state, {
      type: "updateGateSpan",
      itemId: "gate-1",
      rows: 1,
      cols: 2
    });

    expect(next.items).toEqual(state.items);
    expect(next.uiMessage).toBe("Cannot place objects on top of each other.");
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

  it("automatically suppresses only the horizontal wires to the right of a meter", () => {
    const next = editorReducer(initialState, {
      type: "addMeterFromArea",
      start: { row: 0, col: 1 },
      endRow: 1
    });

    const suppressed = getMeterSuppressedHorizontalKeys(next.items, next.steps);

    for (let col = 0; col <= next.steps; col += 1) {
      const expectedSuppressed = col > 1;
      const firstRowSegment = next.items.find(
        (item) => item.type === "horizontalSegment" && item.point.row === 0 && item.point.col === col
      );
      const secondRowSegment = next.items.find(
        (item) => item.type === "horizontalSegment" && item.point.row === 1 && item.point.col === col
      );

      expect(firstRowSegment).toMatchObject({
        type: "horizontalSegment",
        point: { row: 0, col },
        mode: "present"
      });
      expect(secondRowSegment).toMatchObject({
        type: "horizontalSegment",
        point: { row: 1, col },
        mode: "present"
      });
      expect(firstRowSegment && "autoSuppressed" in firstRowSegment ? firstRowSegment.autoSuppressed : undefined).toBe(
        expectedSuppressed ? true : undefined
      );
      expect(secondRowSegment && "autoSuppressed" in secondRowSegment ? secondRowSegment.autoSuppressed : undefined).toBe(
        expectedSuppressed ? true : undefined
      );
      expect(suppressed.has(`0:${col}`)).toBe(expectedSuppressed);
      expect(suppressed.has(`1:${col}`)).toBe(expectedSuppressed);
      expect(next.wireMask[`0:${col}`]).toBe(expectedSuppressed ? "absent" : "present");
      expect(next.wireMask[`1:${col}`]).toBe(expectedSuppressed ? "absent" : "present");
    }
  });

  it("lets the wires tool restore a meter-suppressed horizontal segment", () => {
    const withMeter = editorReducer(initialState, {
      type: "addMeterFromArea",
      start: { row: 0, col: 1 },
      endRow: 0
    });

    const restored = editorReducer(withMeter, {
      type: "addItem",
      tool: "horizontalSegment",
      placement: { kind: "segment", row: 0, col: 2 }
    });

    expect(
      restored.items.find(
        (item) => item.type === "horizontalSegment" && item.point.row === 0 && item.point.col === 2
      )
    ).toMatchObject({
      type: "horizontalSegment",
      point: { row: 0, col: 2 },
      mode: "present"
    });
    expect(restored.wireMask["0:2"]).toBe("present");
  });

  it("draws a vertical wire between two snapped grid points", () => {
    const next = editorReducer(initialState, {
      type: "drawWire",
      start: { row: 0, col: 2 },
      end: { row: 2, col: 2 }
    });

    expect(
      next.items.filter((item) => item.type === "verticalConnector" && item.point.col === 2)
    ).toEqual([
      {
        id: expect.any(String),
        type: "verticalConnector",
        point: { row: 0, col: 2 },
        length: 1,
        wireType: "quantum",
        color: null
      },
      {
        id: expect.any(String),
        type: "verticalConnector",
        point: { row: 1, col: 2 },
        length: 1,
        wireType: "quantum",
        color: null
      }
    ]);
  });

  it("splits imported multi-row vertical connectors into independent unit segments", () => {
    const loaded = editorReducer(initialState, {
      type: "loadQuantikz",
      imported: {
        qubits: 3,
        steps: 3,
        layout: initialState.layout,
        items: [
          {
            id: "line-1",
            type: "verticalConnector",
            point: { row: 0, col: 1 },
            length: 2,
            wireType: "quantum",
            color: null
          }
        ],
        wireTypes: Array.from({ length: 3 }, () => "quantum" as const),
        wireLabels: Array.from({ length: 3 }, () => ({ left: "", right: "" }))
      },
      code: "\\begin{quantikz}\\end{quantikz}",
      preamble: initialState.exportPreamble
    });

    expect(
      loaded.items.filter((item) => item.type === "verticalConnector" && item.point.col === 1)
    ).toEqual([
      {
        id: "line-1",
        type: "verticalConnector",
        point: { row: 0, col: 1 },
        length: 1,
        wireType: "quantum",
        color: null
      },
      {
        id: expect.any(String),
        type: "verticalConnector",
        point: { row: 1, col: 1 },
        length: 1,
        wireType: "quantum",
        color: null
      }
    ]);
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
      items: [
        ...initialState.items,
        {
          id: "line-1",
          type: "horizontalSegment" as const,
          point: { row: 0, col: 0 },
          mode: "present" as const,
          wireType: "quantum" as const,
          color: "#C85D2D" as const
        }
      ],
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
      items: [
        ...initialState.items,
        {
          id: "line-1",
          type: "horizontalSegment" as const,
          point: { row: 0, col: 0 },
          mode: "present" as const,
          wireType: "quantum" as const,
          color: null
        },
        {
          id: "gate-1",
          type: "gate" as const,
          point: { row: 0, col: 1 },
          span: { rows: 1, cols: 1 },
          label: "H",
          width: 40
        }
      ],
      selectedItemIds: ["line-1", "gate-1"]
    };

    const next = editorReducer(state, {
      type: "setHorizontalSegmentsUnlocked",
      unlocked: false
    });

    expect(next.horizontalSegmentsUnlocked).toBe(false);
    expect(next.selectedItemIds).toEqual(["gate-1"]);
  });

  it("filters horizontal segments out of generic selection updates while locked", () => {
    const state = {
      ...initialState,
      horizontalSegmentsUnlocked: false,
      items: [
        ...initialState.items,
        {
          id: "line-1",
          type: "horizontalSegment" as const,
          point: { row: 0, col: 1 },
          mode: "present" as const,
          wireType: "quantum" as const,
          color: null
        },
        {
          id: "gate-1",
          type: "gate" as const,
          point: { row: 0, col: 0 },
          span: { rows: 1, cols: 1 },
          label: "H",
          width: 40
        }
      ]
    };

    const next = editorReducer(state, {
      type: "setSelectedIds",
      itemIds: ["line-1", "gate-1"]
    });

    expect(next.selectedItemIds).toEqual(["gate-1"]);
  });

  it("updates multiple selected controls in one reducer step", () => {
    const state = {
      ...initialState,
      items: [
        ...initialState.items,
        { id: "dot-1", type: "controlDot" as const, point: { row: 0, col: 0 }, controlState: "filled" as const },
        { id: "dot-2", type: "controlDot" as const, point: { row: 1, col: 1 }, controlState: "filled" as const }
      ],
      selectedItemIds: ["dot-1", "dot-2"]
    };

    const next = editorReducer(state, {
      type: "updateControlStateBatch",
      itemIds: ["dot-1", "dot-2"],
      controlState: "open"
    });

    expect(next.items.filter((item) => item.type === "controlDot")).toEqual([
      { id: "dot-1", type: "controlDot", point: { row: 0, col: 0 }, controlState: "open" },
      { id: "dot-2", type: "controlDot", point: { row: 1, col: 1 }, controlState: "open" }
    ]);
  });

  it("updates multiple selected wires to the same wire type in one reducer step", () => {
    const state = {
      ...initialState,
      horizontalSegmentsUnlocked: true,
      items: [
        ...initialState.items,
        { id: "line-h", type: "horizontalSegment" as const, point: { row: 0, col: 1 }, mode: "present" as const, wireType: "quantum" as const, color: null },
        { id: "line-v", type: "verticalConnector" as const, point: { row: 0, col: 2 }, length: 1, wireType: "quantum" as const, color: null }
      ],
      selectedItemIds: ["line-h", "line-v"]
    };

    const next = editorReducer(state, {
      type: "updateWireTypeBatch",
      itemIds: ["line-h", "line-v"],
      wireType: "classical"
    });

    expect(next.items.find((item) => item.id === "line-h")).toMatchObject({ wireType: "classical" });
    expect(next.items.find((item) => item.id === "line-v")).toMatchObject({ wireType: "classical" });
  });

  it("updates multiple selected vertical wires and swap crosses to the same color", () => {
    const state = {
      ...initialState,
      items: [
        ...initialState.items,
        {
          id: "line-v",
          type: "verticalConnector" as const,
          point: { row: 0, col: 2 },
          length: 1,
          wireType: "quantum" as const,
          color: null
        },
        {
          id: "swap-1",
          type: "swapX" as const,
          point: { row: 1, col: 2 },
          color: null
        }
      ],
      selectedItemIds: ["line-v", "swap-1"]
    };

    const next = editorReducer(state, {
      type: "updateItemColorBatch",
      itemIds: ["line-v", "swap-1"],
      color: "#0000FF"
    });

    expect(next.items.find((item) => item.id === "line-v")).toMatchObject({ color: "#0000FF" });
    expect(next.items.find((item) => item.id === "swap-1")).toMatchObject({ color: "#0000FF" });
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

  it("adds an open control dot when requested during placement", () => {
    const next = editorReducer(initialState, {
      type: "addItem",
      tool: "controlDot",
      placement: { kind: "cell", row: 0, col: 1 },
      controlState: "open"
    });

    expect(next.items).toContainEqual({
      id: expect.any(String),
      type: "controlDot",
      point: { row: 0, col: 1 },
      controlState: "open",
      color: null
    });
  });

  it("rejects pasting a copied group onto occupied cells", () => {
    const clipboard = buildClipboard([
      {
        id: "gate-1",
        type: "gate",
        point: { row: 0, col: 0 },
        span: { rows: 1, cols: 1 },
        label: "H",
        width: 40
      }
    ]);

    const state = {
      ...initialState,
      items: [
        ...initialState.items,
        { id: "dot-1", type: "controlDot" as const, point: { row: 1, col: 1 } }
      ]
    };

    const next = editorReducer(state, {
      type: "pasteClipboard",
      clipboard: clipboard!,
      anchor: { row: 1, col: 1 }
    });

    expect(next.items).toEqual(state.items);
    expect(next.uiMessage).toBe("Copied group cannot be placed there.");
  });
});
