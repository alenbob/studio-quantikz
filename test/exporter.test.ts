  it("exports both quantum and classical vertical wires in the same column", () => {
    const code = exportToQuantikz(
      makeState({
        qubits: 3,
        steps: 2,
        items: [
          { id: "dot-1", type: "controlDot", point: { row: 0, col: 1 } },
          { id: "line-q", type: "verticalConnector", point: { row: 0, col: 1 }, length: 1, wireType: "quantum" },
          { id: "plus-1", type: "targetPlus", point: { row: 1, col: 1 } },
          { id: "line-c", type: "verticalConnector", point: { row: 1, col: 1 }, length: 1, wireType: "classical" },
          { id: "plus-2", type: "targetPlus", point: { row: 2, col: 1 } }
        ]
      })
    );

    // Should emit a control with classical vertical wire and a classical vertical wire
    expect(code).toContain("\\ctrl[vertical wire=c]{1}");
    expect(code).toContain("\\wire[d][1]{c}");
  });
import { describe, expect, it } from "vitest";
import { exportToQuantikz } from "../src/renderer/exporter";
import { importFromQuantikz } from "../src/renderer/importer";
import { editorReducer, initialState } from "../src/renderer/reducer";
import type { EditorState } from "../src/renderer/types";

function makeState(overrides: Partial<EditorState>): EditorState {
  return {
    qubits: 3,
    steps: 5,
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
            point: { row: 1, col: 2 },
            span: { rows: 1, cols: 1 }
          }
        ]
      })
    );

    expect(code).toContain("\\meter{}");
    expect(code).not.toContain("\\qw");
  });

  it("exports an equals column as a midstick with broken wires on both sides", () => {
    const code = exportToQuantikz(
      makeState({
        items: [
          {
            id: "gate-left",
            type: "gate",
            point: { row: 0, col: 0 },
            span: { rows: 1, cols: 1 },
            label: "H",
            width: 40
          },
          {
            id: "equals-1",
            type: "equalsColumn",
            point: { row: 0, col: 1 }
          },
          {
            id: "gate-right",
            type: "gate",
            point: { row: 0, col: 2 },
            span: { rows: 1, cols: 1 },
            label: "X",
            width: 40
          }
        ]
      })
    );

    expect(code).toContain("\\midstick[wires=3]{=}");
    expect(code).toMatch(/\\gate\{H\}\s+&\s+\\midstick\[wires=3\]\{=\}\s+\\setwiretype\{n\}\s+&\s+\\gate\{X\}\s+\\setwiretype\{n\}/);
  });

  it("exports a wide gate with an explicit minimum width", () => {
    const code = exportToQuantikz(
      makeState({
        items: [
          {
            id: "gate-wide",
            type: "gate",
            point: { row: 0, col: 0 },
            span: { rows: 2, cols: 3 },
            label: "U",
            width: 40
          }
        ]
      })
    );

    expect(code).toContain("\\gate[wires=2,style={minimum width=2.1cm}]{U} & \\ghost{U} & \\ghost{U}");
  });

  it("exports slice and group math labels with math delimiters", () => {
    const code = exportToQuantikz(
      makeState({
        items: [
          {
            id: "frame-1",
            type: "frame",
            point: { row: 0, col: 0 },
            span: { rows: 2, cols: 2 },
            label: "\\theta_0",
            rounded: true,
            dashed: true,
            background: true,
            innerXSepPt: 2,
            color: null
          },
          {
            id: "slice-1",
            type: "slice",
            point: { row: 0, col: 2 },
            label: "\\phi",
            color: null
          }
        ]
      })
    );

    expect(code).toContain("\\gategroup[2,steps=2,style={rounded corners,dashed,inner xsep=2pt},background]{$\\theta_0$}");
    expect(code).toContain("\\slice{$\\phi$}");
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

  it("exports merged wire labels without comments", () => {
    const code = exportToQuantikz(
      makeState({
        qubits: 3,
        wireLabels: [
          { left: "input", right: "", leftSpan: 2, leftBracket: "brace" },
          { left: "", right: "" },
          { left: "", right: "" }
        ]
      })
    );

    expect(code).not.toContain("%");
    expect(code).toContain("\\lstick[wires=2,braces=right]{input}");
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
            wireType: "quantum",
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

  it("uses named-color style options for selected swatch wires and swap crosses", () => {
    const code = exportToQuantikz(
      makeState({
        items: [
          {
            id: "swap-top",
            type: "swapX",
            point: { row: 0, col: 1 },
            color: "#0000FF"
          },
          {
            id: "swap-wire",
            type: "verticalConnector",
            point: { row: 0, col: 1 },
            length: 1,
            wireType: "quantum",
            color: "#0000FF"
          },
          {
            id: "swap-bottom",
            type: "swapX",
            point: { row: 1, col: 1 },
            color: "#0000FF"
          }
        ]
      })
    );

    expect(code).toContain("\\swap[style={draw=blue},wire style={draw=blue}]{1}");
    expect(code).toContain("\\targX[style={draw=blue}]{}");
  });

  it("styles standalone vertical wires without redundant xcolor prefixes", () => {
    const code = exportToQuantikz(
      makeState({
        items: [
          {
            id: "line-green",
            type: "verticalConnector",
            point: { row: 0, col: 2 },
            length: 2,
            wireType: "quantum",
            color: "#00FF00"
          }
        ]
      })
    );

    expect(code).toContain("\\wire[d][2][draw=green]{q}");
  });

  it("exports a controlled-not from dot, connector, and plus", () => {
    const code = exportToQuantikz(
      makeState({
        items: [
          { id: "dot-1", type: "controlDot", point: { row: 0, col: 2 } },
          { id: "line-1", type: "verticalConnector", point: { row: 0, col: 2 }, length: 1, wireType: "quantum" },
          { id: "plus-1", type: "targetPlus", point: { row: 1, col: 2 } }
        ]
      })
    );

    expect(code).toContain("\\ctrl{1}");
    expect(code).toContain("\\targ{}");
  });

  it("merges consecutive connector pieces in one column into a Toffoli-style stack", () => {
    const code = exportToQuantikz(
      makeState({
        items: [
          { id: "dot-1", type: "controlDot", point: { row: 0, col: 2 } },
          { id: "dot-2", type: "controlDot", point: { row: 1, col: 2 } },
          { id: "line-1", type: "verticalConnector", point: { row: 0, col: 2 }, length: 1, wireType: "quantum" },
          { id: "line-2", type: "verticalConnector", point: { row: 1, col: 2 }, length: 1, wireType: "quantum" },
          { id: "plus-1", type: "targetPlus", point: { row: 2, col: 2 } }
        ]
      })
    );

    expect(code.match(/\\ctrl\{1\}/g)?.length).toBe(2);
    expect(code).toContain("\\targ{}");
    expect(code).not.toContain("\\ctrl{2}");
  });

  it("exports open controls as c0 controls", () => {
    const code = exportToQuantikz(
      makeState({
        items: [
          { id: "dot-open", type: "controlDot", point: { row: 0, col: 1 }, controlState: "open" },
          { id: "line-1", type: "verticalConnector", point: { row: 0, col: 1 }, length: 1, wireType: "quantum" },
          { id: "plus-1", type: "targetPlus", point: { row: 1, col: 1 } },
          { id: "dot-standalone", type: "controlDot", point: { row: 2, col: 3 }, controlState: "open" }
        ]
      })
    );

    expect(code).toContain("\\octrl{1}");
    expect(code).toContain("\\ocontrol{}");
  });

  it("exports a middle target with open controls above and below as a general multi-controlled slice", () => {
    const code = exportToQuantikz(
      makeState({
        items: [
          { id: "dot-top", type: "controlDot", point: { row: 0, col: 1 }, controlState: "open" },
          { id: "line-top", type: "verticalConnector", point: { row: 0, col: 1 }, length: 1, wireType: "quantum" },
          { id: "plus-mid", type: "targetPlus", point: { row: 1, col: 1 } },
          { id: "line-bottom", type: "verticalConnector", point: { row: 1, col: 1 }, length: 1, wireType: "quantum" },
          { id: "dot-bottom", type: "controlDot", point: { row: 2, col: 1 }, controlState: "open" }
        ]
      })
    );

    expect(code.match(/\\ocontrol\{\}/g)?.length).toBe(2);
    expect(code).toContain("\\targ{}");
    expect(code.match(/\\wire\[d\]\[1\]\{q\}/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("treats a meter as a valid connector target", () => {
    const code = exportToQuantikz(
      makeState({
        items: [
          { id: "dot-1", type: "controlDot", point: { row: 0, col: 1 } },
          { id: "line-1", type: "verticalConnector", point: { row: 0, col: 1 }, length: 1, wireType: "quantum" },
          { id: "meter-1", type: "meter", point: { row: 1, col: 1 }, span: { rows: 1, cols: 1 } }
        ]
      })
    );

    expect(code).toContain("\\ctrl{1}");
    expect(code).toContain("\\meter{}");
    expect(code).not.toContain("\\wire[d][1]{q}");
  });

  it("exports a post-measurement control path as classical wiring", () => {
    const code = exportToQuantikz(
      makeState({
        items: [
          { id: "meter-1", type: "meter", point: { row: 0, col: 0 }, span: { rows: 1, cols: 1 } },
          { id: "segment-1", type: "horizontalSegment", point: { row: 0, col: 1 }, mode: "present", wireType: "classical" },
          { id: "dot-1", type: "controlDot", point: { row: 0, col: 1 } },
          { id: "line-1", type: "verticalConnector", point: { row: 0, col: 1 }, length: 1, wireType: "classical" },
          { id: "gate-1", type: "gate", point: { row: 1, col: 1 }, span: { rows: 1, cols: 1 }, label: "A", width: 40 }
        ]
      })
    );

    expect(code).toContain("\\meter{}");
    expect(code).toContain("\\ctrl[vertical wire=c]{1}");
    expect(code).toContain("\\setwiretype{n}");
    expect(code).toContain("\\gate{A}");
  });

  it("exports a swap from paired X markers", () => {
    const code = exportToQuantikz(
      makeState({
        items: [
          { id: "swap-1", type: "swapX", point: { row: 0, col: 3 } },
          { id: "line-1", type: "verticalConnector", point: { row: 0, col: 3 }, length: 2, wireType: "quantum" },
          { id: "swap-2", type: "swapX", point: { row: 2, col: 3 } }
        ]
      })
    );

    expect(code).toContain("\\swap{2}");
    expect(code.match(/\\targX\{\}/g)?.length).toBe(1);
  });

  it("exports a controlled swap gate with a shared connector", () => {
    const code = exportToQuantikz(
      makeState({
        qubits: 4,
        items: [
          { id: "ctrl-1", type: "controlDot", point: { row: 0, col: 2 } },
          { id: "swap-1", type: "swapX", point: { row: 1, col: 2 } },
          { id: "swap-2", type: "swapX", point: { row: 3, col: 2 } },
          { id: "line-1", type: "verticalConnector", point: { row: 0, col: 2 }, length: 1, wireType: "quantum" },
          { id: "line-2", type: "verticalConnector", point: { row: 1, col: 2 }, length: 2, wireType: "quantum" }
        ],
        wireTypes: Array.from({ length: 4 }, () => "quantum"),
        wireLabels: Array.from({ length: 4 }, () => ({ left: "", right: "" }))
      })
    );

    expect(code).toContain("\\ctrl{1}");
    expect(code).toContain("\\swap{2}");
    expect(code.match(/\\targX\{\}/g)?.length).toBe(1);
  });

  it("falls back to a raw wire command for a standalone connector", () => {
    const code = exportToQuantikz(
      makeState({
        items: [
          { id: "line-1", type: "verticalConnector", point: { row: 0, col: 1 }, length: 2, wireType: "quantum" }
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
          { id: "line-1", type: "verticalConnector", point: { row: 0, col: 1 }, length: 1, wireType: "quantum" }
        ]
      })
    );

    expect(code).toContain("\\gate{A}");
    expect(code).toContain("\\gate{B}");
    expect(code).toContain("\\wire[d][1]{q}");
  });

  it("merges a long raw vertical connector into one quantikz wire command", () => {
    const code = exportToQuantikz(
      makeState({
        qubits: 3,
        steps: 2,
        items: [
          { id: "line-1", type: "verticalConnector", point: { row: 0, col: 0 }, length: 2, wireType: "quantum" }
        ]
      })
    );

    expect(code).toContain("\\wire[d][2]{q}");
    expect(code).not.toContain("\\wire[d][1]{q}");
  });

  it("exports right and left corner shorthand through wire overrides", () => {
    const code = exportToQuantikz(
      makeState({
        items: [
          { id: "dot-a", type: "controlDot", point: { row: 0, col: 0 } },
          { id: "dot-b", type: "controlDot", point: { row: 1, col: 0 } },
          { id: "line-a", type: "verticalConnector", point: { row: 0, col: 0 }, length: 2, wireType: "quantum" },
          { id: "dot-c", type: "controlDot", point: { row: 0, col: 2 } },
          { id: "dot-d", type: "controlDot", point: { row: 1, col: 2 } },
          { id: "line-b", type: "verticalConnector", point: { row: 0, col: 2 }, length: 2, wireType: "quantum" },
          { id: "gap-right", type: "horizontalSegment", point: { row: 2, col: 0 }, mode: "absent", wireType: "quantum" },
          { id: "gap-left", type: "horizontalSegment", point: { row: 2, col: 3 }, mode: "absent", wireType: "quantum" }
        ],
        wireMask: {
          "2:0": "absent",
          "2:3": "absent"
        },
        steps: 4
      })
    );

    const controlCommandCount = code.match(/\\(?:o?ctrl\{1\}|o?control\{\})/g)?.length ?? 0;
    expect(controlCommandCount).toBeGreaterThanOrEqual(4);
    expect(code.match(/\\setwiretype\{n\}/g)?.length).toBeGreaterThanOrEqual(2);
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
          { id: "line-1", type: "verticalConnector", point: { row: 0, col: 2 }, length: 2, wireType: "quantum" },
          { id: "plus-1", type: "targetPlus", point: { row: 2, col: 2 } },
          { id: "swap-1", type: "swapX", point: { row: 0, col: 4 } },
          { id: "line-2", type: "verticalConnector", point: { row: 0, col: 4 }, length: 1, wireType: "quantum" },
          { id: "swap-2", type: "swapX", point: { row: 1, col: 4 } }
        ]
      })
    );

    expect(code).toContain("\\gate{H}");
    expect(code).toContain("\\gate[wires=2]{U}");
    expect(code).toContain("\\ctrl{2}");
    expect(code).toContain("\\swap{1}");
    expect(code.match(/\\targX\{\}/g)?.length).toBe(1);
  });

  it("exports frames and slices with quantikz annotations", () => {
    const code = exportToQuantikz(
      makeState({
        qubits: 2,
        steps: 4,
        items: [
          {
            id: "frame-1",
            type: "frame",
            point: { row: 0, col: 0 },
            span: { rows: 2, cols: 2 },
            label: "Entangle",
            rounded: true,
            dashed: true,
            background: true,
            innerXSepPt: 2
          },
          {
            id: "slice-1",
            type: "slice",
            point: { row: 0, col: 1 },
            label: "prepare"
          }
        ]
      })
    );

    expect(code).toContain("\\gategroup[2,steps=2,style={rounded corners,dashed,inner xsep=2pt},background]{Entangle}");
    expect(code).toContain("\\slice{prepare}");
  });

  it("places gate-like commands before raw vertical wires and slices in the same cell", () => {
    const code = exportToQuantikz(
      makeState({
        qubits: 2,
        steps: 2,
        items: [
          {
            id: "gate-top",
            type: "gate",
            point: { row: 0, col: 0 },
            span: { rows: 1, cols: 1 },
            label: "A",
            width: 40
          },
          {
            id: "gate-bottom",
            type: "gate",
            point: { row: 1, col: 0 },
            span: { rows: 1, cols: 1 },
            label: "B",
            width: 40
          },
          { id: "line-1", type: "verticalConnector", point: { row: 0, col: 0 }, length: 1, wireType: "quantum" },
          { id: "slice-1", type: "slice", point: { row: 0, col: 0 }, label: "mark" }
        ]
      })
    );

    expect(code).toContain("\\gate{A} \\wire[d][1]{q} \\slice{mark}");
  });

  it("places control and target commands before same-cell annotations and horizontal wires", () => {
    const code = exportToQuantikz(
      makeState({
        qubits: 2,
        steps: 2,
        items: [
          { id: "dot-1", type: "controlDot", point: { row: 0, col: 0 } },
          { id: "line-1", type: "verticalConnector", point: { row: 0, col: 0 }, length: 1, wireType: "quantum" },
          { id: "plus-1", type: "targetPlus", point: { row: 1, col: 0 } },
          { id: "slice-1", type: "slice", point: { row: 0, col: 0 }, label: "s" },
          {
            id: "segment-c",
            type: "horizontalSegment",
            point: { row: 1, col: 0 },
            mode: "present",
            wireType: "classical",
            color: null
          },
          {
            id: "frame-1",
            type: "frame",
            point: { row: 1, col: 0 },
            span: { rows: 1, cols: 1 },
            label: "G",
            rounded: false,
            dashed: false,
            background: false,
            innerXSepPt: 0
          }
        ]
      })
    );

    expect(code).toContain("\\ctrl{1} \\slice{s}");
    expect(code).toContain("\\targ{} \\wireoverride{c} \\gategroup[1,steps=1]{G}");
  });

  it("exports one control connected to multiple targets in the same column", () => {
    const code = exportToQuantikz(
      makeState({
        qubits: 3,
        steps: 3,
        items: [
          { id: "dot-1", type: "controlDot", point: { row: 0, col: 1 } },
          { id: "line-1", type: "verticalConnector", point: { row: 0, col: 1 }, length: 2, wireType: "quantum" },
          { id: "plus-1", type: "targetPlus", point: { row: 1, col: 1 } },
          { id: "plus-2", type: "targetPlus", point: { row: 2, col: 1 } }
        ]
      })
    );

    expect(code).toContain("\\ctrl{1}");
    expect(code).not.toContain("\\ctrl{2}");
    expect(code).toContain("\\targ{} \\wire[d][1]{q}");
    expect(code.match(/\\targ\{\}/g)?.length).toBe(2);
  });

  it("exports per-segment classical wires and overrides", () => {
    const code = exportToQuantikz(
      makeState({
        qubits: 2,
        steps: 3,
        items: [
          {
            id: "segment-q",
            type: "horizontalSegment",
            point: { row: 0, col: 1 },
            mode: "present",
            wireType: "classical",
            color: null
          },
          {
            id: "segment-gap",
            type: "horizontalSegment",
            point: { row: 1, col: 2 },
            mode: "absent",
            wireType: "quantum",
            color: null
          }
        ]
      })
    );

    expect(code).toContain("\\wireoverride{c}");
    expect(code).toContain("\\setwiretype{n}");
  });

  it("exports qwbundle for bundle-style horizontal segments", () => {
    const code = exportToQuantikz(
      makeState({
        qubits: 4,
        steps: 6,
        items: [
          {
            id: "bundle-1",
            type: "horizontalSegment",
            point: { row: 1, col: 0 },
            mode: "present",
            wireType: "quantum",
            bundled: true,
            bundleLabel: "2N_a",
            color: null
          }
        ]
      })
    );

    expect(code).toContain("\\qwbundle{2N_a}");
    expect(code).not.toContain("\\wireoverride{c}");
  });

  it("uses empty quantikz cells instead of explicit qw commands for default wires", () => {
    const code = exportToQuantikz(
      makeState({
        qubits: 2,
        steps: 3,
        items: [
          {
            id: "gate-1",
            type: "gate",
            point: { row: 0, col: 0 },
            span: { rows: 1, cols: 1 },
            label: "H",
            width: 40
          },
          { id: "dot-1", type: "controlDot", point: { row: 0, col: 1 } },
          { id: "line-1", type: "verticalConnector", point: { row: 0, col: 1 }, length: 1, wireType: "quantum" },
          { id: "plus-1", type: "targetPlus", point: { row: 1, col: 1 } }
        ]
      })
    );

    expect(code).not.toContain("\\qw");
    expect(code).toContain("\\gate{H} & \\ctrl{1}");
    expect(code).toContain("& \\targ{}");
  });

  it("omits the trailing auxiliary cell after a row ends in a meter", () => {
    const code = exportToQuantikz(
      makeState({
        qubits: 1,
        steps: 4,
        wireLabels: [{ left: "", right: "" }],
        items: [
          {
            id: "meter-1",
            type: "meter",
            point: { row: 0, col: 2 },
            span: { rows: 1, cols: 1 }
          }
        ]
      })
    );

    const meterRow = code.split("\n")[1]?.trim() ?? "";

    expect(meterRow).toContain("\\meter{}");
    expect(meterRow.endsWith("&")).toBe(false);
  });

  it("does not pad entirely empty rows just because auto wires are present", () => {
    const code = exportToQuantikz(
      makeState({
        qubits: 3,
        steps: 5,
        items: [
          {
            id: "meter-1",
            type: "meter",
            point: { row: 0, col: 0 },
            span: { rows: 1, cols: 1 }
          }
        ]
      })
    );

    const rows = code.split("\n").slice(1, -1).map((row) => row.trim());

    expect(rows[1].startsWith("&")).toBe(true);
    expect(rows[2]).toBe("&");
  });

  it("adds a single trailing empty cell only when the row ends with a live wire", () => {
    const code = exportToQuantikz(
      makeState({
        qubits: 1,
        steps: 4,
        wireLabels: [{ left: "", right: "" }],
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

    const gateRow = code.split("\n")[1]?.trim() ?? "";

    expect(gateRow).toBe("& \\gate{H} &");
  });

  it("compacts consecutive absent helper cells with setwiretype", () => {
    const code = exportToQuantikz(
      makeState({
        qubits: 1,
        steps: 4,
        wireLabels: [{ left: "", right: "" }],
        items: [
          {
            id: "gap-1",
            type: "horizontalSegment",
            point: { row: 0, col: 1 },
            mode: "absent",
            wireType: "quantum",
            color: null
          },
          {
            id: "gap-2",
            type: "horizontalSegment",
            point: { row: 0, col: 2 },
            mode: "absent",
            wireType: "quantum",
            color: null
          },
          {
            id: "gate-1",
            type: "gate",
            point: { row: 0, col: 3 },
            span: { rows: 1, cols: 1 },
            label: "H",
            width: 40
          }
        ]
      })
    );

    expect(code).toContain("\\setwiretype{n}");
    expect(code).toContain("\\gate{H} \\setwiretype{q}");
  });

  it("preserves imported wireoverride gaps without inserting a synthetic restore", () => {
    const code = String.raw`\begin{quantikz}
& \wireoverride{n} & \gate{H} &
\end{quantikz}`;

    const imported = importFromQuantikz(code);
    const loaded = editorReducer(initialState, {
      type: "loadQuantikz",
      imported,
      code,
      preamble: ""
    });
    const exported = exportToQuantikz(loaded);

    expect(exported).toContain("\\wireoverride{n} & \\gate{H}");
    expect(exported).not.toContain("\\setwiretype{q} & \\gate{H}");
  });

  it("preserves imported setwiretype restores on the cell where they were specified", () => {
    const code = String.raw`\begin{quantikz}
& \setwiretype{n} &  & \gate{H} \setwiretype{q} &
\end{quantikz}`;

    const imported = importFromQuantikz(code);
    const loaded = editorReducer(initialState, {
      type: "loadQuantikz",
      imported,
      code,
      preamble: ""
    });
    const exported = exportToQuantikz(loaded);

    expect(exported).toContain("\\setwiretype{n} &  & \\gate{H} \\setwiretype{q}");
    expect(exported).not.toContain("\\setwiretype{n} & \\setwiretype{q} & \\gate{H}");
  });

  it("exports manually built absent runs with boundary setwiretype transitions instead of repeating n in occupied cells", () => {
    const code = exportToQuantikz(
      makeState({
        qubits: 2,
        steps: 7,
        wireLabels: [{ left: "", right: "" }, { left: "", right: "" }],
        items: [
          {
            id: "gap-1",
            type: "horizontalSegment",
            point: { row: 0, col: 1 },
            mode: "absent",
            wireType: "quantum",
            color: null
          },
          {
            id: "gap-2",
            type: "horizontalSegment",
            point: { row: 0, col: 2 },
            mode: "absent",
            wireType: "quantum",
            color: null
          },
          { id: "dot-1", type: "controlDot", point: { row: 0, col: 3 } },
          { id: "line-1", type: "verticalConnector", point: { row: 0, col: 3 }, length: 1, wireType: "quantum" },
          { id: "plus-1", type: "targetPlus", point: { row: 1, col: 3 } },
          {
            id: "gap-3",
            type: "horizontalSegment",
            point: { row: 0, col: 5 },
            mode: "absent",
            wireType: "quantum",
            color: null
          },
          {
            id: "gap-4",
            type: "horizontalSegment",
            point: { row: 0, col: 6 },
            mode: "absent",
            wireType: "quantum",
            color: null
          }
        ]
      })
    );

    expect(code).toContain("\\setwiretype{n} &  & \\ctrl{1} \\setwiretype{q} &  & \\setwiretype{n}");
    expect(code).not.toContain("\\ctrl{1} \\setwiretype{q} \\setwiretype{n}");
    expect(code).not.toContain("& \\setwiretype{n} & \\setwiretype{n}");
  });

  it("exports classical connectors with the proper Quantikz option", () => {
    const code = exportToQuantikz(
      makeState({
        items: [
          { id: "dot-1", type: "controlDot", point: { row: 0, col: 1 } },
          { id: "line-1", type: "verticalConnector", point: { row: 0, col: 1 }, length: 1, wireType: "classical" },
          { id: "plus-1", type: "targetPlus", point: { row: 1, col: 1 } }
        ]
      })
    );

    expect(code).toContain("\\ctrl[vertical wire=c]{1}");
  });
});
