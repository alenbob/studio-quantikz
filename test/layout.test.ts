import { describe, expect, it } from "vitest";
import { DEFAULT_CIRCUIT_LAYOUT, getColumnMetrics } from "../src/renderer/layout";
import type { CircuitItem } from "../src/renderer/types";

describe("layout column metrics", () => {
  it("widens only the columns that contain wider gate content", () => {
    const items: CircuitItem[] = [
      {
        id: "gate-wide",
        type: "gate",
        point: { row: 0, col: 1 },
        span: { rows: 1, cols: 1 },
        label: "\\mathrm{Uniform}_{n_\\mathrm{bath}+1}",
        width: 148
      }
    ];

    const metrics = getColumnMetrics(3, items, DEFAULT_CIRCUIT_LAYOUT);

    expect(metrics.widths[1]).toBeGreaterThan(metrics.widths[0]);
    expect(metrics.widths[1]).toBeGreaterThan(metrics.widths[2]);
  });
});
