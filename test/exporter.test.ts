import { describe, expect, it } from "vitest";
import { exportToQuantikz } from "../src/renderer/exporter";
import type { EditorState } from "../src/renderer/types";

function makeState(overrides: Partial<EditorState>): EditorState {
  return {
    qubits: 3,
    steps: 5,
    layout: { rowSepCm: 0.9, columnSepCm: 0.7 },
    items: [],
    wireMask: {},
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

describe("exportToQuantikz", () => {
  it("exports a single labeled gate", () => {
    const code = exportToQuantikz(
      makeState({
        items: [
          {
            id: "gate-1",
            type: "gate",
            point: { row: 0, col: 0 },
            span: { rows: 1, cols: 1 },
            label: "H",
            width: 40
          }
        ]
      })
    );

    expect(code).toContain("\\begin{quantikz}[row sep={0.9cm,between origins}, column sep=0.7cm]");
    expect(code).toContain("\\gate{H}");
  });

  it("exports a multi-qubit gate", () => {
    const code = exportToQuantikz(
      makeState({
        items: [
          {
            id: "gate-1",
            type: "gate",
            point: { row: 0, col: 1 },
            span: { rows: 2, cols: 1 },
            label: "U",
            width: 52
          }
        ]
      })
    );

    expect(code).toContain("\\gate[wires=2]{U}");
  });

  it("exports a measurement object", () => {
    const code = exportToQuantikz(
      makeState({
        items: [
          {
            id: "meter-1",
            type: "meter",
            point: { row: 1, col: 2 }
          }
        ]
      })
    );

    expect(code).toContain("\\meter{}");
  });

  it("exports TeX-style gate labels without forcing extra math delimiters", () => {
    const code = exportToQuantikz(
      makeState({
        items: [
          {
            id: "gate-tex",
            type: "gate",
            point: { row: 0, col: 0 },
            span: { rows: 1, cols: 1 },
            label: "\\theta_0",
            width: 64
          }
        ]
      })
    );

    expect(code).toContain("\\gate{\\theta_0}");
  });

  it("escapes LaTeX special characters in plain-text gate labels", () => {
    const code = exportToQuantikz(
      makeState({
        items: [
          {
            id: "gate-text",
            type: "gate",
            point: { row: 0, col: 0 },
            span: { rows: 1, cols: 1 },
            label: "A&B 50% #1",
            width: 90
          }
        ]
      })
    );

    expect(code).toContain("\\gate{A\\&B 50\\% \\#1}");
  });

  it("exports left and right wire labels", () => {
    const code = exportToQuantikz(
      makeState({
        wireLabels: [
          { left: "\\ket{0}", right: "\\ket{+}" },
          { left: "", right: "" },
          { left: "", right: "" }
        ]
      })
    );

    expect(code).toContain("\\lstick{$\\ket{0}$}");
    expect(code).toContain("\\rstick{$\\ket{+}$}");
  });

  it("exports custom row and column spacing in the quantikz options", () => {
    const code = exportToQuantikz(
      makeState({
        layout: { rowSepCm: 1.15, columnSepCm: 0.95 }
      })
    );

    expect(code).toContain("\\begin{quantikz}[row sep={1.15cm,between origins}, column sep=0.95cm]");
  });

  it("includes color styles in generated commands", () => {
    const code = exportToQuantikz(
      makeState({
        items: [
          {
            id: "gate-color",
            type: "gate",
            point: { row: 0, col: 0 },
            span: { rows: 1, cols: 1 },
            label: "H",
            width: 40,
            color: "#C85D2D"
          },
          {
            id: "dot-color",
            type: "controlDot",
            point: { row: 0, col: 1 },
            color: "#0F6A6D"
          },
          {
            id: "line-color",
            type: "verticalConnector",
            point: { row: 0, col: 1 },
            length: 1,
            color: "#0F6A6D"
          },
          {
            id: "plus-color",
            type: "targetPlus",
            point: { row: 1, col: 1 },
            color: "#0F6A6D"
          }
        ]
      })
    );

    expect(code).toContain("style={draw={rgb,255:red,200;green,93;blue,45}");
    expect(code).toContain("\\ctrl[style={draw={rgb,255:red,15;green,106;blue,109},fill={rgb,255:red,15;green,106;blue,109}},wire style={draw={rgb,255:red,15;green,106;blue,109}}]{1}");
  });

  it("exports a controlled-not from dot, connector, and plus", () => {
    const code = exportToQuantikz(
      makeState({
        items: [
          { id: "dot-1", type: "controlDot", point: { row: 0, col: 2 } },
          { id: "line-1", type: "verticalConnector", point: { row: 0, col: 2 }, length: 1 },
          { id: "plus-1", type: "targetPlus", point: { row: 1, col: 2 } }
        ]
      })
    );

    expect(code).toContain("\\ctrl{1}");
    expect(code).toContain("\\targ{}");
  });

  it("treats a meter as a valid connector target", () => {
    const code = exportToQuantikz(
      makeState({
        items: [
          { id: "dot-1", type: "controlDot", point: { row: 0, col: 1 } },
          { id: "line-1", type: "verticalConnector", point: { row: 0, col: 1 }, length: 1 },
          { id: "meter-1", type: "meter", point: { row: 1, col: 1 } }
        ]
      })
    );

    expect(code).toContain("\\ctrl{1}");
    expect(code).toContain("\\meter{}");
    expect(code).not.toContain("\\wire[d][1]{q}");
  });

  it("exports a swap from paired X markers", () => {
    const code = exportToQuantikz(
      makeState({
        items: [
          { id: "swap-1", type: "swapX", point: { row: 0, col: 3 } },
          { id: "line-1", type: "verticalConnector", point: { row: 0, col: 3 }, length: 2 },
          { id: "swap-2", type: "swapX", point: { row: 2, col: 3 } }
        ]
      })
    );

    expect(code).toContain("\\swap{2}");
    expect(code).toContain("\\targX{}");
  });

  it("falls back to a raw wire command for a standalone connector", () => {
    const code = exportToQuantikz(
      makeState({
        items: [
          { id: "line-1", type: "verticalConnector", point: { row: 0, col: 1 }, length: 2 }
        ]
      })
    );

    expect(code).toContain("\\wire[d][2]{q}");
  });

  it("keeps a raw vertical connector between gate cells", () => {
    const code = exportToQuantikz(
      makeState({
        items: [
          {
            id: "gate-top",
            type: "gate",
            point: { row: 0, col: 1 },
            span: { rows: 1, cols: 1 },
            label: "A",
            width: 40
          },
          {
            id: "gate-bottom",
            type: "gate",
            point: { row: 1, col: 1 },
            span: { rows: 1, cols: 1 },
            label: "B",
            width: 40
          },
          { id: "line-1", type: "verticalConnector", point: { row: 0, col: 1 }, length: 1 }
        ]
      })
    );

    expect(code).toContain("\\gate{A}");
    expect(code).toContain("\\gate{B}");
    expect(code).toContain("\\wire[d][1]{q}");
  });

  it("exports right and left corner shorthand through wire overrides", () => {
    const code = exportToQuantikz(
      makeState({
        items: [
          { id: "dot-a", type: "controlDot", point: { row: 0, col: 0 } },
          { id: "dot-b", type: "controlDot", point: { row: 1, col: 0 } },
          { id: "line-a", type: "verticalConnector", point: { row: 0, col: 0 }, length: 2 },
          { id: "dot-c", type: "controlDot", point: { row: 0, col: 2 } },
          { id: "dot-d", type: "controlDot", point: { row: 1, col: 2 } },
          { id: "line-b", type: "verticalConnector", point: { row: 0, col: 2 }, length: 2 },
          { id: "gap-right", type: "horizontalSegment", point: { row: 2, col: 0 }, mode: "absent" },
          { id: "gap-left", type: "horizontalSegment", point: { row: 2, col: 3 }, mode: "absent" }
        ],
        wireMask: {
          "2:0": "absent",
          "2:3": "absent"
        },
        steps: 4
      })
    );

    expect(code.match(/\\ctrl\{1\}/g)?.length).toBeGreaterThanOrEqual(4);
    expect(code.match(/\\wireoverride\{n\}/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("exports a mixed circuit across multiple steps", () => {
    const code = exportToQuantikz(
      makeState({
        qubits: 3,
        steps: 5,
        items: [
          {
            id: "gate-1",
            type: "gate",
            point: { row: 0, col: 0 },
            span: { rows: 1, cols: 1 },
            label: "H",
            width: 40
          },
          {
            id: "gate-2",
            type: "gate",
            point: { row: 1, col: 1 },
            span: { rows: 2, cols: 1 },
            label: "U",
            width: 52
          },
          { id: "dot-1", type: "controlDot", point: { row: 0, col: 2 } },
          { id: "line-1", type: "verticalConnector", point: { row: 0, col: 2 }, length: 2 },
          { id: "plus-1", type: "targetPlus", point: { row: 2, col: 2 } },
          { id: "swap-1", type: "swapX", point: { row: 0, col: 4 } },
          { id: "line-2", type: "verticalConnector", point: { row: 0, col: 4 }, length: 1 },
          { id: "swap-2", type: "swapX", point: { row: 1, col: 4 } }
        ]
      })
    );

    expect(code).toContain("\\gate{H}");
    expect(code).toContain("\\gate[wires=2]{U}");
    expect(code).toContain("\\ctrl{2}");
    expect(code).toContain("\\swap{1}");
  });
});
