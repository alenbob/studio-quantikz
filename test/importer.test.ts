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
          { id: "line-1", type: "verticalConnector", point: { row: 0, col: 1 }, length: 1 }
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
});
