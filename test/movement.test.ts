import { describe, expect, it } from "vitest";
import { projectSelectionMove } from "../src/renderer/movement";
import type { CircuitItem, PlacementTarget } from "../src/renderer/types";

describe("projectSelectionMove", () => {
  it("projects every selected object when dragging a multi-item selection", () => {
    const items: CircuitItem[] = [
      {
        id: "gate-a",
        type: "gate",
        point: { row: 0, col: 0 },
        span: { rows: 1, cols: 1 },
        label: "U",
        width: 40,
        color: null
      },
      {
        id: "gate-b",
        type: "gate",
        point: { row: 1, col: 1 },
        span: { rows: 1, cols: 1 },
        label: "V",
        width: 40,
        color: null
      }
    ];

    const placement: PlacementTarget = { kind: "cell", row: 1, col: 2 };
    const projection = projectSelectionMove(items, ["gate-a", "gate-b"], "gate-a", placement);

    expect(projection).not.toBeNull();
    expect(projection?.movedItems).toHaveLength(2);
    expect(projection?.rowDelta).toBe(1);
    expect(projection?.colDelta).toBe(2);
    expect(projection?.finalItems.map((item) => ({ id: item.id, point: item.point }))).toEqual([
      { id: "gate-a", point: { row: 1, col: 2 } },
      { id: "gate-b", point: { row: 2, col: 3 } }
    ]);
  });
});