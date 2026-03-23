import { describe, expect, it } from "vitest";
import { exportToQuantikz } from "../src/renderer/exporter";
import { importFromQuantikz } from "../src/renderer/importer";
import { isVisibleHorizontalSegment } from "../src/renderer/horizontalWires";
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
    expect(imported.steps).toBe(3);
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
& \gate{H}\gategroup[2,steps=2,style={rounded corners, dashed, inner xsep=2pt},background]{$\theta$} & \ctrl{1}\slice{$\phi$} & \meter{} \\
&  & \targ{} & \meter{}
\end{quantikz}`;

    const imported = importFromQuantikz(code);
    const frame = imported.items.find((item) => item.type === "frame");
    const slice = imported.items.find((item) => item.type === "slice");

    expect(frame && frame.type === "frame" ? frame.span : null).toEqual({ rows: 2, cols: 2 });
    expect(frame && frame.type === "frame" ? frame.label : "").toBe("\\theta");
    expect(slice && slice.type === "slice" ? slice.label : "").toBe("\\phi");
  });

  it("imports an equals separator column from a midstick command", () => {
    const code = String.raw`\begin{quantikz}
\midstick[wires=3]{=} & \gate{H} \\
 & \qw \\
 & \qw
\end{quantikz}`;

    const imported = importFromQuantikz(code);

    expect(imported.items).toContainEqual(expect.objectContaining({
      type: "equalsColumn",
      point: { row: 0, col: 0 }
    }));
    expect(imported.items.some((item) => item.type === "gate" && item.point.row === 0 && item.point.col === 1)).toBe(true);
  });

  it("imports the new exported equals-and-gap form with setwiretype", () => {
    const code = String.raw`\begin{quantikz}[row sep={0.9cm,between origins}, column sep=0.7cm]
 &  &  & \midstick[wires=3]{=} &  &  & \setwiretype{n} \\
 &  &  &  &  &  & \setwiretype{n} \\
 &  &  &  &  &  & \setwiretype{n}
\end{quantikz}`;

    const imported = importFromQuantikz(code);
    const equalsColumn = imported.items.find((item) => item.type === "equalsColumn");
    const absentSegments = imported.items.filter(
      (item) => item.type === "horizontalSegment" && item.mode === "absent" && item.point.col === 5
    );

    expect(imported.qubits).toBe(3);
    expect(imported.steps).toBe(5);
    expect(equalsColumn && equalsColumn.type === "equalsColumn" ? equalsColumn.point : null).toEqual({ row: 0, col: 2 });
    expect(absentSegments).toHaveLength(3);
  });

  it("imports ghost continuation cells as a multi-step gate span", () => {
    const code = String.raw`\begin{quantikz}
& \gate[wires=2,style={minimum width=2.1cm}]{U} & \ghost{U} & \ghost{U} \\
&  &  &
\end{quantikz}`;

    const imported = importFromQuantikz(code);
    const gate = imported.items.find((item) => item.type === "gate");

    expect(gate && gate.type === "gate" ? gate.span : null).toEqual({ rows: 2, cols: 3 });
    expect(imported.steps).toBe(3);
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

  it("imports xcolor-prefixed named colors for swaps and vertical wires", () => {
    const code = String.raw`\begin{quantikz}
& \color{blue}\swap[style={draw=blue},wire style={draw=blue}]{1} \\
& \color{blue}\targX[style={draw=blue}]{}
\end{quantikz}`;

    const imported = importFromQuantikz(code);
    const swapItems = imported.items.filter((item) => item.type === "swapX");
    const connector = imported.items.find((item) => item.type === "verticalConnector");

    expect(swapItems).toHaveLength(2);
    expect(swapItems.every((item) => item.type === "swapX" && item.color === "#0000FF")).toBe(true);
    expect(connector && connector.type === "verticalConnector" ? connector.color : null).toBe("#0000FF");
  });

  it("resolves preamble-defined colors used in imported gate styles", () => {
    const code = String.raw`\begin{quantikz}
& \gate[style={fill=X1!40,draw=X1}]{H}
\end{quantikz}`;

    const imported = importFromQuantikz(code, {
      preamble: String.raw`\definecolor{X1}{RGB}{200,93,45}`
    });
    const gate = imported.items.find((item) => item.type === "gate");

    expect(gate && gate.type === "gate" ? gate.color : null).toBe("#E9BEAB");
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

  it("imports setwiretype runs as persistent horizontal wire changes", () => {
    const code = String.raw`\begin{quantikz}
 & \setwiretype{n} &  & \setwiretype{q} \gate{H}
\end{quantikz}`;

    const imported = importFromQuantikz(code);
    const absentSegment = imported.items.find(
      (item) =>
        item.type === "horizontalSegment" &&
        item.point.row === 0 &&
        item.point.col === 0 &&
        item.mode === "absent"
    );
    const continuedAbsentSegment = imported.items.find(
      (item) =>
        item.type === "horizontalSegment" &&
        item.point.row === 0 &&
        item.point.col === 1 &&
        item.mode === "absent"
    );
    const restoredSegment = imported.items.find(
      (item) =>
        item.type === "horizontalSegment" &&
        item.point.row === 0 &&
        item.point.col === 2 &&
        item.mode === "present"
    );
    const restoredGate = imported.items.find(
      (item) => item.type === "gate" && item.point.row === 0 && item.point.col === 2
    );

    expect(absentSegment).toBeTruthy();
    expect(continuedAbsentSegment).toBeTruthy();
    expect(restoredSegment).toBeTruthy();
    expect(restoredGate).toBeTruthy();
  });

  it("imports persistent absent runs through cells that also contain vertical commands", () => {
    const code = String.raw`\begin{quantikz}
& \control{} \\
& \setwiretype{n} & \control{} \wire[d][1]{q} &  & \setwiretype{q} \gate{H} \\
&  & \targ{} &  &
\end{quantikz}`;

    const imported = importFromQuantikz(code);
    const absentAtControlCell = imported.items.find(
      (item) =>
        item.type === "horizontalSegment" &&
        item.point.row === 1 &&
        item.point.col === 1 &&
        item.mode === "absent"
    );
    const absentAtBlankCell = imported.items.find(
      (item) =>
        item.type === "horizontalSegment" &&
        item.point.row === 1 &&
        item.point.col === 2 &&
        item.mode === "absent"
    );

    expect(absentAtControlCell).toBeTruthy();
    expect(absentAtBlankCell).toBeTruthy();
  });

  it("keeps trailing boundary segments absent after loading a row that ends under setwiretype n", () => {
    const code = String.raw`\begin{quantikz}[row sep={0.9cm,between origins}, column sep=0.7cm]
\lstick{$\ket{+}_{c_0}$} & \control{} \wire[d][2]{q} &  &  &  &  &  & \control{} \wire[d][2]{q} & \control{} \wire[d][4]{q} &  & \control{} \wire[d][4]{q} & \ctrl{5} &  \\
\lstick{$\ket{+}_{c_1}$} & \control{} &  &  &  &  &  & \ocontrol{} &  &  &  &  &  \\
 & \wireoverride{n} & \control{} \wire[d][2]{q} &  & \ctrl{2} &  & \control{} \wire[d][2]{q} &  & \setwiretype{n} &  &  &  &  \\
\lstick{$\ket{+}_{c_2}$} &  & \control{} &  &  &  & \ocontrol{} &  & \control{} &  & \control{} &  &  \\
 & \setwiretype{n} &  & \ctrl{4} \setwiretype{q} & \targ{} & \ctrl{2} &  & \setwiretype{n} &  & \ctrl{3} \setwiretype{q} &  & \setwiretype{n} &  \\
\lstick{$\ket{\psi_0}$} &  &  &  &  &  &  &  &  &  &  & \gate{A} &  \\
\lstick{$\ket{\psi_1}$} &  &  &  &  & \gate{A} &  &  &  &  &  &  &  \\
\lstick{$\ket{\psi_2}$} &  &  &  &  &  &  &  &  & \gate{A} &  &  &  \\
\lstick{$\ket{\psi_3}$} &  &  & \gate{A} &  &  &  &  &  &  &  &  & 
\end{quantikz}`;

    const imported = importFromQuantikz(code);
    const loaded = editorReducer(initialState, {
      type: "loadQuantikz",
      imported,
      code,
      preamble: ""
    });

    const visibleCols = loaded.items
      .filter((item) => item.type === "horizontalSegment" && item.point.row === 2 && isVisibleHorizontalSegment(item))
      .map((item) => item.point.col)
      .sort((left, right) => left - right);

    expect(visibleCols).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("imports qwbundle segments from a multi-register circuit", () => {
    const code = String.raw`\begin{quantikz}
        \lstick{$\ket{0}_{succ}$} &&& \gate[4,style={fill=X1!40,rounded corners}]{\hat{\mathcal{U}}_R} \gategroup[4,steps=3,style={dashed,rounded
			corners,fill=X3!40, inner
			xsep=0pt},background,label style={label
			position=above,anchor=north,yshift=0.3cm}]{$\textrm{RIXS}(\omega_I)$} & \gate[4,style={fill=X2!40,rounded corners}]{ \left(\hat{\mathcal{Q}}_R\right)^{K_{A}}} & \meter{0} \\
        \lstick{$\ket{\vec 0}_{sys}$} & \qwbundle{2N_a} &&&&& \rstick{$\rixs$} \\
        \lstick{$\ket{\vec{0}}_{anc}$} & \qwbundle{n_D+1} &&&&& \rstick{$\ket{\vec 0}$} \\
        \lstick{$\ket{\vec{0}}_{W}$} & \qwbundle{n_W} &&&&&
    \end{quantikz}`;

    const imported = importFromQuantikz(code);
    const bundles = imported.items.filter((item) => item.type === "horizontalSegment" && item.bundled === true);

    expect(imported.qubits).toBe(4);
    expect(bundles).toHaveLength(3);
    expect(bundles.map((item) => item.point.row)).toEqual([1, 2, 3]);
    expect(bundles.map((item) => item.point.col)).toEqual([0, 0, 0]);
    expect(bundles.map((item) => item.type === "horizontalSegment" ? item.bundleLabel : "")).toEqual([
      "2N_a",
      "n_D+1",
      "n_W"
    ]);
    expect(imported.items.some((item) => item.type === "gate" && item.point.row === 0 && item.point.col === 2)).toBe(true);
    expect(imported.items.some((item) => item.type === "meter" && item.point.row === 0 && item.point.col === 4)).toBe(true);
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

  it("preserves an explicit trailing wire override when it needs an auxiliary quantikz cell", () => {
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
