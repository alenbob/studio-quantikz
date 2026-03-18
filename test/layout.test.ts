import { describe, expect, it } from "vitest";
import { DEFAULT_CIRCUIT_LAYOUT, getColumnMetrics, measureGateHeight } from "../src/renderer/layout";
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

  it("gives taller math labels more vertical room than a simple symbol", () => {
    expect(measureGateHeight("\\frac{a}{b}")).toBeGreaterThan(measureGateHeight("H"));
  });

  it("widens adjacent horizontal wire space for bundled math labels", () => {
    const items: CircuitItem[] = [
      {
        id: "bundle-1",
        type: "horizontalSegment",
        point: { row: 0, col: 1 },
        mode: "present",
        wireType: "quantum",
        bundled: true,
        bundleLabel: "\\frac{n_D+1}{2}",
        color: null
      }
    ];

    const metrics = getColumnMetrics(3, items, DEFAULT_CIRCUIT_LAYOUT);

    expect(metrics.widths[0]).toBeGreaterThan(72);
    expect(metrics.widths[1]).toBeGreaterThan(72);
  });
});
