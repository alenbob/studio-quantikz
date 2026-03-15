import { describe, expect, it } from "vitest";
import { exportToQuantikz } from "../src/renderer/exporter";
import { importFromQuantikz } from "../src/renderer/importer";
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

describe("importFromQuantikz", () => {
  it("round-trips a circuit exported by the editor", () => {
    const exported = exportToQuantikz(
      makeState({
        qubits: 3,
        steps: 4,
        layout: { rowSepCm: 1.15, columnSepCm: 0.95 },
        wireLabels: [
          { left: "\\ket{c}_C", right: "" },
          { left: "\\ket{0}", right: "" },
          { left: "\\ket{\\psi}_S", right: "" }
        ],
        items: [
          {
            id: "gate-1",
            type: "gate",
            point: { row: 1, col: 0 },
            span: { rows: 1, cols: 1 },
            label: "\\mathrm{PREPARE}",
            width: 120
          },
          {
            id: "gate-2",
            type: "gate",
            point: { row: 1, col: 1 },
            span: { rows: 2, cols: 1 },
            label: "\\mathrm{SELECT}",
            width: 128
          },
          {
            id: "gate-3",
            type: "gate",
            point: { row: 1, col: 2 },
            span: { rows: 1, cols: 1 },
            label: "\\mathrm{PREPARE}^{\\dagger}",
            width: 168
          },
          { id: "ctrl-1", type: "controlDot", point: { row: 0, col: 1 } },
          { id: "line-1", type: "verticalConnector", point: { row: 0, col: 1 }, length: 1, wireType: "quantum" }
        ]
      })
    );

    const imported = importFromQuantikz(exported);

    expect(imported.qubits).toBe(3);
    expect(imported.steps).toBe(4);
    expect(imported.layout).toEqual({ rowSepCm: 1.15, columnSepCm: 0.95 });
    expect(imported.wireLabels[0].left).toBe("\\ket{c}_C");
    expect(imported.items.filter((item) => item.type === "gate")).toHaveLength(3);
    expect(imported.items.some((item) => item.type === "verticalConnector" && item.point.row === 0 && item.point.col === 1 && item.length === 1)).toBe(true);
  });

  it("imports standard quantikz rows with math wire labels and plain gate labels", () => {
    const code = String.raw`\begin{quantikz}[row sep={0.9cm,between origins}, column sep=0.7cm]
\lstick{$\ket{c}_C$}
  & \qw
  & \ctrl{1}
  & \qw
  & \qw
\\
\lstick{$\ket{0\cdots 0}_{I,A,K,R,F}$}
  & \gate{\mathrm{PREPARE}}
  & \gate[wires=2]{\mathrm{SELECT}}
  & \gate{\mathrm{PREPARE}^{\dagger}}
  & \qw
\\
\lstick{$\ket{\psi}_S$}
  & \qw
  &
  & \qw
  & \qw
\end{quantikz}`;

    const imported = importFromQuantikz(code);
    const selectGate = imported.items.find(
      (item) => item.type === "gate" && item.point.row === 1 && item.point.col === 1
    );

    expect(imported.wireLabels[0].left).toBe("\\ket{c}_C");
    expect(imported.wireLabels[1].left).toBe("\\ket{0\\cdots 0}_{I,A,K,R,F}");
    expect(selectGate && selectGate.type === "gate" ? selectGate.label : "").toBe("\\mathrm{SELECT}");
    expect(selectGate && selectGate.type === "gate" ? selectGate.span.rows : 0).toBe(2);
    expect(imported.items.some((item) => item.type === "controlDot" && item.point.row === 0 && item.point.col === 1)).toBe(true);
  });

  it("imports gategroups and slices as annotation items", () => {
    const code = String.raw`\begin{quantikz}
& \gate{H}\gategroup[2,steps=2,style={rounded corners, dashed, inner xsep=2pt},background]{Entangle} & \ctrl{1}\slice{prepare} & \meter{} \\
&  & \targ{} & \meter{}
\end{quantikz}`;

    const imported = importFromQuantikz(code);
    const frame = imported.items.find((item) => item.type === "frame");
    const slice = imported.items.find((item) => item.type === "slice");

    expect(frame && frame.type === "frame" ? frame.span : null).toEqual({ rows: 2, cols: 2 });
    expect(frame && frame.type === "frame" ? frame.label : "").toBe("Entangle");
    expect(slice && slice.type === "slice" ? slice.label : "").toBe("prepare");
  });

  it("imports a measurement object and its controlling connector", () => {
    const code = String.raw`\begin{quantikz}
\lstick{$\ket{0}$} & \ctrl{1} \\
\lstick{$\ket{\psi}$} & \meter{}
\end{quantikz}`;

    const imported = importFromQuantikz(code);

    expect(imported.items.some((item) => item.type === "meter" && item.point.row === 1 && item.point.col === 0)).toBe(true);
    expect(imported.items.some((item) => item.type === "controlDot" && item.point.row === 0 && item.point.col === 0)).toBe(true);
    expect(imported.items.some((item) => item.type === "verticalConnector" && item.point.row === 0 && item.point.col === 0 && item.length === 1)).toBe(true);
  });

  it("imports open controls from octrl and ocontrol commands", () => {
    const code = String.raw`\begin{quantikz}
\lstick{$\ket{0}$} & \octrl{1} & \ocontrol{} \\
\lstick{$\ket{\psi}$} & \targ{} & \qw
\end{quantikz}`;

    const imported = importFromQuantikz(code);
    const openControls = imported.items.filter((item) => item.type === "controlDot");

    expect(openControls).toHaveLength(2);
    expect(openControls.every((item) => item.type === "controlDot" && item.controlState === "open")).toBe(true);
  });

  it("imports a controlled swap gate into swap markers plus merged connectors", () => {
    const code = String.raw`\begin{quantikz}
\lstick{$\ket{c}$} & \ctrl{1} \\
\lstick{$\ket{0}$} & \swap{2} \\
\lstick{$\ket{0}$} & \qw \\
\lstick{$\ket{0}$} & \targX{}
\end{quantikz}`;

    const imported = importFromQuantikz(code);

    expect(imported.items.filter((item) => item.type === "controlDot")).toHaveLength(1);
    expect(imported.items.filter((item) => item.type === "swapX")).toHaveLength(2);
    expect(
      imported.items.some((item) => item.type === "verticalConnector" && item.point.row === 0 && item.point.col === 0 && item.length === 3)
    ).toBe(true);
  });

  it("merges multiple imported control offsets into one visual control with a shared connector", () => {
    const code = String.raw`\begin{quantikz}
\lstick{$\ket{0}$} & \ctrl{1} \ctrl{2} \\
\lstick{$\ket{0}$} & \targ{} \\
\lstick{$\ket{0}$} & \targ{}
\end{quantikz}`;

    const imported = importFromQuantikz(code);

    expect(imported.items.filter((item) => item.type === "controlDot")).toHaveLength(1);
    expect(imported.items.filter((item) => item.type === "verticalConnector")).toHaveLength(1);
    expect(imported.items.filter((item) => item.type === "targetPlus")).toHaveLength(2);
  });

  it("imports classical row wires and classical connector hints", () => {
    const code = String.raw`\begin{quantikz}[wire types={c,q}]
\lstick{$\ket{0}$} & \wireoverride{q} & \ctrl[vertical wire=c]{1} \\
\lstick{$\ket{\psi}$} &  & \targ{}
\end{quantikz}`;

    const imported = importFromQuantikz(code);
    const override = imported.items.find(
      (item) => item.type === "horizontalSegment" && item.point.row === 0 && item.point.col === 0
    );
    const connector = imported.items.find((item) => item.type === "verticalConnector");

    expect(imported.wireTypes[0]).toBe("classical");
    expect(override && override.type === "horizontalSegment" ? override.wireType : "").toBe("quantum");
    expect(connector && connector.type === "verticalConnector" ? connector.wireType : "").toBe("classical");
  });

  it("imports vqw and vcw connectors as vertical wires", () => {
    const code = String.raw`\begin{quantikz}
\lstick{$\ket{0}$} & \vqw{1} & \vcw{1} \\
\lstick{$\ket{\psi}$} & \qw & \qw
\end{quantikz}`;

    const imported = importFromQuantikz(code);
    const quantumConnector = imported.items.find(
      (item) =>
        item.type === "verticalConnector" &&
        item.point.row === 0 &&
        item.point.col === 0 &&
        item.length === 1
    );
    const classicalConnector = imported.items.find(
      (item) =>
        item.type === "verticalConnector" &&
        item.point.row === 0 &&
        item.point.col === 1 &&
        item.length === 1
    );

    expect(quantumConnector && quantumConnector.type === "verticalConnector" ? quantumConnector.wireType : "").toBe("quantum");
    expect(classicalConnector && classicalConnector.type === "verticalConnector" ? classicalConnector.wireType : "").toBe("classical");
  });

  it("imports merged wire labels with their span metadata", () => {
    const code = String.raw`% quantikzz-wirelabel:left:0:2:brace
\begin{quantikz}
\lstick[wires=2,braces=right]{input} & \gate{H} \\
 & \qw
\end{quantikz}`;

    const imported = importFromQuantikz(code);

    expect(imported.wireLabels[0].left).toBe("input");
    expect(imported.wireLabels[0].leftSpan).toBe(2);
    expect(imported.wireLabels[0].leftBracket).toBe("brace");
  });

  it("imports a right label that shares its last cell with a qw command", () => {
    const code = String.raw`\begin{quantikz}
\lstick{$\ket{0}$} & \gate{H} & \rstick[wires=2]{$out$}\qw \\
\lstick{$\ket{0}$} & \qw & \qw
\end{quantikz}`;

    const imported = importFromQuantikz(code);

    expect(imported.steps).toBe(2);
    expect(imported.wireLabels[0].right).toBe("out");
    expect(imported.wireLabels[0].rightSpan).toBe(2);
    expect(imported.items.some((item) => item.type === "gate" && item.point.row === 0 && item.point.col === 0)).toBe(true);
  });

  it("imports a right label with a matrix phantom and math delimiters", () => {
    const code = String.raw`\begin{quantikz}[row sep={0.9cm,between origins}, column sep=0.7cm]
 & \qw & \qw & \qw & \qw & \qw & \rstick[wires=2,braces=none]{$\left[\vphantom{\begin{matrix}.\\.\end{matrix}}\right.$} \\
 & \qw & \qw & \qw & \qw & \qw & \\
 & \qw & \qw & \qw & \qw & \qw &
\end{quantikz}`;

    const imported = importFromQuantikz(code);

    expect(imported.qubits).toBe(3);
    expect(imported.steps).toBe(5);
    expect(imported.wireLabels[0].right).toBe("\\left[\\vphantom{\\begin{matrix}.\\\\.\\end{matrix}}\\right.");
    expect(imported.wireLabels[0].rightSpan).toBe(2);
    expect(imported.wireLabels[0].rightBracket).toBe("none");
  });

  it("preserves the logical step count when a trailing wire override needs an auxiliary quantikz cell", () => {
    const exported = exportToQuantikz(
      makeState({
        qubits: 2,
        steps: 3,
        items: [
          {
            id: "gate-1",
            type: "gate",
            point: { row: 0, col: 1 },
            span: { rows: 1, cols: 1 },
            label: "H",
            width: 40
          },
          {
            id: "override-1",
            type: "horizontalSegment",
            point: { row: 0, col: 3 },
            mode: "absent",
            wireType: "quantum",
            color: null
          }
        ]
      })
    );

    const imported = importFromQuantikz(exported);
    const trailingOverride = imported.items.find(
      (item) =>
        item.type === "horizontalSegment" &&
        item.point.row === 0 &&
        item.point.col === 3 &&
        item.mode === "absent"
    );

    expect(imported.steps).toBe(3);
    expect(trailingOverride).toBeTruthy();
  });
});
