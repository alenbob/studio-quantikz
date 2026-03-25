import { describe, expect, it } from "vitest";
import { renderSymbolicLatex } from "../src/server/renderSymbolicLatex";

const AND_CIRCUIT = String.raw`\begin{quantikz}[row sep={0.9cm,between origins}, column sep=0.7cm]
\lstick{$\ket{+}_{c_0}$} & \control{} \wire[d][2]{q} &  & \control{} \wire[d][2]{q} &  \\
\lstick{$\ket{+}_{c_1}$} & \control{} &  & \control{} &  \\
 & \wireoverride{n} & \ctrl{1} &  & \wireoverride{n} \\
\lstick{$\ket{\psi}$} &  & \gate{A} &  &
\end{quantikz}`;

const NO_OP_CIRCUIT = String.raw`\begin{quantikz}[row sep={0.9cm,between origins}, column sep=0.7cm]
\lstick{$\ket{a}$} &  &  &  \\
\lstick{$\ket{b}$} &  &  &  \\
\lstick{$\ket{c}$} &  &  &
\end{quantikz}`;

const SWAP_CIRCUIT = String.raw`\begin{quantikz}[row sep={0.9cm,between origins}, column sep=0.7cm]
\lstick{$\ket{+}_{c_0}$} & \swap{1} &  \\
\lstick{$\ket{+}_{c_1}$} & \targX{} &
\end{quantikz}`;

const NESTED_ANCILLA_CIRCUIT = String.raw`\begin{quantikz}[row sep={0.9cm,between origins}, column sep=0.7cm]
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

const UNLABELED_NO_OP_CIRCUIT = String.raw`\begin{quantikz}
 &  &  \\
 &  &
\end{quantikz}`;

const NAMED_GATE_CIRCUIT = String.raw`\begin{quantikz}
\lstick{$\ket{0}$} & \gate{H} & \gate{H}
\end{quantikz}`;

const SAME_COLUMN_GATES_CIRCUIT = String.raw`\begin{quantikz}
\lstick{$\ket{0}$} & \gate{H} & \gate{Z} \\
\lstick{$\ket{1}$} & \gate{X} &
\end{quantikz}`;

const T_GATE_CIRCUIT = String.raw`\begin{quantikz}
\lstick{$\ket{1}$} & \gate{T} & \meter{}
\end{quantikz}`;

const PAULI_ROTATION_CIRCUIT = String.raw`\begin{quantikz}
\lstick{$\ket{0}$} & \gate{R_X(\theta)} \\
\lstick{$\ket{1}$} & \gate{R_{y}(\arccos(t))}
\end{quantikz}`;

const RZ_ROTATION_CIRCUIT = String.raw`\begin{quantikz}
\lstick{$\ket{1}$} & \gate{R_z(2\phi + \pi/3)}
\end{quantikz}`;

const CONTROLLED_RY_ROW_ORDER_CIRCUIT = String.raw`\begin{quantikz}[row sep={0.9cm,between origins}, column sep=0.7cm]
\lstick{$\ket{0}$} &  & \gate{R_y(\arccos{1/3})} &  &  &  &  \\
\lstick{$\ket{1}$} &  & \ctrl{-1} &  &  &  &
\end{quantikz}`;

const CONTROLLED_RY_CASCADE_CIRCUIT = String.raw`\begin{quantikz}[row sep={0.9cm,between origins}, column sep=0.7cm]
\lstick{$\ket{0}$} &  & \gate{R_y(2\arccos{\sqrt{b}})} & \ctrl{1} &  \\
\lstick{$\ket{0}$} & \gate{R_y(2\arccos{\sqrt{a}})} & \ctrl{-1} & \targ{} &
\end{quantikz}`;

const NAMED_WIRE_CONTROLLED_RY_CASCADE_CIRCUIT = String.raw`\begin{quantikz}[row sep={0.9cm,between origins}, column sep=0.7cm]
\lstick{$\ket{0}_{c_0}$} &  & \gate{R_y(2\arccos{\sqrt{b}})} & \ctrl{1} &  \\
\lstick{$\ket{0}_{c_1}$} & \gate{R_y(2\arccos{\sqrt{a}})} & \ctrl{-1} & \targ{} &
\end{quantikz}`;

const FRACTIONAL_CONTROLLED_RY_CIRCUIT = String.raw`\begin{quantikz}[row sep={0.9cm,between origins}, column sep=0.7cm]
\lstick{$\ket{0}_{c_0}$} &  & \gate{R_y(2\arccos{\sqrt{\frac15}})} & \ctrl{1} &  \\
\lstick{$\ket{0}_{c_1}$} & \gate{R_y(2\arccos{\sqrt{\frac{tN}{\lambda}}})} & \ctrl{-1} & \targ{} &
\end{quantikz}`;

const NAMED_WIRE_MEASUREMENT_CIRCUIT = String.raw`\begin{quantikz}
\lstick{$\ket{1}_{c_0}$} & \meter{}
\end{quantikz}`;

const ROTATED_MEASUREMENT_CIRCUIT = String.raw`\begin{quantikz}
\lstick{$\ket{0}$} & \gate{R_y(\theta)} & \meter{}
\end{quantikz}`;

const INTERFERING_ROTATED_MEASUREMENT_CIRCUIT = String.raw`\begin{quantikz}
\lstick{$\ket{0}$} & \gate{H} & \gate{R_y(\theta)} & \meter{}
\end{quantikz}`;

const POST_MEASUREMENT_REMAINDER_CIRCUIT = String.raw`\begin{quantikz}
\lstick{$\ket{+}$} & \meter{} \\
\lstick{$\ket{\psi}$} &
\end{quantikz}`;

const MULTI_QUBIT_MEASUREMENT_CIRCUIT = String.raw`\begin{quantikz}
\lstick[wires=2]{$\ket{+0}$} & \meter[wires=2]{} \\
 &
\end{quantikz}`;

const MID_CIRCUIT_MEASUREMENT_BRANCHING_CIRCUIT = String.raw`\begin{quantikz}
\lstick{$\ket{+}$} & \meter{} &  \\
\lstick{$\ket{0}$} &  & \gate{H}
\end{quantikz}`;

const WIDE_CONTROLLED_YY_CIRCUIT = String.raw`\begin{quantikz}[row sep={0.9cm,between origins}, column sep=0.7cm]
\lstick[wires=2,braces=none]{$\ket{00}$} & \gate[wires=2]{YY} &  & \\
 & \wire[d][1]{q} & \gate{X} & \\
\lstick{$\ket{1}$} & \control{} &  &
\end{quantikz}`;

const WIDE_HADAMARD_CIRCUIT = String.raw`\begin{quantikz}
\lstick[wires=2]{$\ket{00}$} & \gate[wires=2]{H} \\
 &
\end{quantikz}`;

const SYMBOLIC_GATE_WITH_LATER_CONTROLLED_X_CIRCUIT = String.raw`\begin{quantikz}[row sep={0.9cm,between origins}, column sep=0.7cm]
\lstick{$\ket{0}$} & \gate{H} & \ctrl{1} &  & \ctrl{1} & \gate{H} & \meter{} \\
\lstick{$\ket{0}$} &  & \targ{} & \gate{A} & \targ{} &  &  &
\end{quantikz}`;

const BRANCHED_MULTI_CONTROLLED_SYMBOLIC_GATE_CIRCUIT = String.raw`\begin{quantikz}
\lstick{$\ket{0}_{c_0}$} & \gate{H} & \ctrl{2} \\
\lstick{$\ket{0}_{c_1}$} & \gate{H} & \ctrl{1} \\
\lstick{$\ket{\psi}_{t}$} &  & \gate{A}
\end{quantikz}`;

const MIXED_MULTI_CONTROLLED_GATE_MISMATCH_CIRCUIT = String.raw`\begin{quantikz}
\lstick{$\ket{1}_{c_0}$} & \ocontrol{} \wire[d][1]{q} \\
\lstick{$\ket{1}_{c_1}$} & \ctrl{1} \\
\lstick{$\ket{0}_{t}$} & \gate{X}
\end{quantikz}`;

const MIXED_MULTI_CONTROLLED_X_MISMATCH_CIRCUIT = String.raw`\begin{quantikz}
\lstick{$\ket{1}_{c_0}$} & \ocontrol{} \wire[d][1]{q} \\
\lstick{$\ket{1}_{c_1}$} & \ctrl{1} \\
\lstick{$\ket{0}_{t}$} & \targ{}
\end{quantikz}`;

const UNLABELED_TOFFOLI_CIRCUIT = String.raw`\begin{quantikz}
 & \ctrl{1} \\
 & \ctrl{1} \\
 & \targ{}
\end{quantikz}`;

const UNLABELED_MIXED_MULTI_CONTROLLED_GATE_CIRCUIT = String.raw`\begin{quantikz}
 & \octrl{2} \\
 & \ctrl{1} \\
 & \gate{A}
\end{quantikz}`;

const UNLABELED_ALL_OPEN_MULTI_CONTROLLED_X_CIRCUIT = String.raw`\begin{quantikz}
 & \octrl{2} \\
 & \octrl{1} \\
 & \targ{}
\end{quantikz}`;

const VARIED_ORDER_TARGET_TOP_OPEN_CONTROLS_CIRCUIT = String.raw`\begin{quantikz}
 & \targ{} \\
 & \octrl{-1} \\
 & \octrl{-2}
\end{quantikz}`;

const VARIED_ORDER_GATE_MIDDLE_OPEN_CONTROLS_CIRCUIT = String.raw`\begin{quantikz}
 & \octrl{1} \\
 & \gate{A} \\
 & \octrl{-1}
\end{quantikz}`;

const VARIED_ORDER_SWAP_WITH_CONTROL_BELOW_CIRCUIT = String.raw`\begin{quantikz}
\lstick{$\ket{0}$} & \swap{1} \\
\lstick{$\ket{1}$} & \targX{} \\
\lstick{$\ket{0}$} & \octrl{-2}
\end{quantikz}`;

const VARIED_ORDER_CONTROLLED_MEASURE_MATCH_CIRCUIT = String.raw`\begin{quantikz}
\lstick{$\ket{0}$} & \octrl{1} \\
\lstick{$\ket{1}$} & \meter{} \\
\lstick{$\ket{0}$} & \octrl{-1}
\end{quantikz}`;

const VARIED_ORDER_CONTROLLED_MEASURE_MISMATCH_CIRCUIT = String.raw`\begin{quantikz}
\lstick{$\ket{1}$} & \ctrl{1} \\
\lstick{$\ket{0}$} & \meter{} \\
\lstick{$\ket{0}$} & \ctrl{-1}
\end{quantikz}`;

describe("renderSymbolicLatex", () => {
  it("returns generated latex from the Python symbolic engine", async () => {
    const result = await renderSymbolicLatex(AND_CIRCUIT);

    expect(result).toMatchObject({
      success: true,
      envIndex: 0,
      latex: expect.stringContaining(String.raw`\begin{equation*}`)
    });
    if (!result.success) {
      throw new Error(result.error);
    }

    expect(result.latex).toContain(String.raw`\textbf{Slice 1: } compute AND into ancilla $a_{2}$`);
    expect(result.latex).toContain(String.raw`\textbf{Slice 3: } uncompute AND and remove ancilla $a_{2}$`);
  });

  it("rejects empty quantikz input before invoking the Python bridge", async () => {
    const result = await renderSymbolicLatex("");

    expect(result).toEqual({
      success: false,
      error: "Quantikz code is required."
    });
  });

  it("returns the initial state for a label-only circuit", async () => {
    const result = await renderSymbolicLatex(NO_OP_CIRCUIT);

    expect(result).toMatchObject({
      success: true,
      envIndex: 0,
      latex: expect.stringContaining(String.raw`\ket{\Psi_{0}} &= \ket{a} \otimes \ket{b} \otimes \ket{c}`)
    });
  });

  it("defaults unlabeled input rows to ket{0}", async () => {
    const result = await renderSymbolicLatex(UNLABELED_NO_OP_CIRCUIT);

    expect(result).toMatchObject({
      success: true,
      envIndex: 0,
      latex: expect.stringContaining(String.raw`\ket{\Psi_{0}} &= \ket{0} \otimes \ket{0}`)
    });
  });

  it("supports a swap slice", async () => {
    const result = await renderSymbolicLatex(SWAP_CIRCUIT);

    expect(result).toMatchObject({
      success: true,
      envIndex: 0,
      latex: expect.stringContaining(String.raw`\textbf{Slice 1: } swap $c_0$ and $c_1$`)
    });
  });

  it("supports nested blank ancilla rows reused across slices", async () => {
    const result = await renderSymbolicLatex(NESTED_ANCILLA_CIRCUIT);

    expect(result).toMatchObject({
      success: true,
      envIndex: 0,
      latex: expect.stringContaining(String.raw`\textbf{Slice 2: } compute AND into ancilla $a_{4}$`)
    });
    if (!result.success) {
      throw new Error(result.error);
    }

    expect(result.latex).toContain(String.raw`\textbf{Slice 6: } uncompute AND and remove ancilla $a_{4}$`);
    expect(result.latex).toContain(String.raw`\textbf{Slice 8: } compute AND into ancilla $a_{4}$`);
    expect(result.latex).toContain(String.raw`\textbf{Slice 10: } uncompute AND and remove ancilla $a_{4}$`);
  });

  it("applies named single-qubit gates on computational basis states", async () => {
    const result = await renderSymbolicLatex(NAMED_GATE_CIRCUIT);

    expect(result).toMatchObject({
      success: true,
      envIndex: 0,
      latex: expect.stringContaining(String.raw`\ket{\Psi_{2}} &= \ket{0}`)
    });
    if (!result.success) {
      throw new Error(result.error);
    }

    expect(result.latex).toContain(
      String.raw`\ket{\Psi_{1}} &= \left(\frac{1}{\sqrt{2}} \ket{0} + \frac{1}{\sqrt{2}} \ket{1}\right)`
    );
  });

  it("applies the T gate as an exact phase on basis states", async () => {
    const result = await renderSymbolicLatex(T_GATE_CIRCUIT);

    expect(result).toMatchObject({
      success: true,
      envIndex: 0
    });
    if (!result.success) {
      throw new Error(result.error);
    }

    expect(result.latex).toContain(String.raw`\ket{\Psi_{1}} &= \frac{1 + i}{\sqrt{2}} \ket{1}`);
    expect(result.latex).toContain(String.raw`\Pr(q_{0}=1)=1`);
  });

  it("renders Pauli-axis rotations as symbolic basis-state branches", async () => {
    const result = await renderSymbolicLatex(PAULI_ROTATION_CIRCUIT);

    expect(result).toMatchObject({
      success: true,
      envIndex: 0
    });
    if (!result.success) {
      throw new Error(result.error);
    }

    expect(result.latex).toContain(
      String.raw`\ket{\Psi_{1}} &= \left(\cos\left(\frac{\theta}{2}\right) \ket{0} - i \sin\left(\frac{\theta}{2}\right) \ket{1}\right) \otimes \ket{1}`
    );
    expect(result.latex).toContain(
      String.raw`\ket{\Psi_{2}} &= \left(\cos\left(\frac{\theta}{2}\right) \ket{0} - i \sin\left(\frac{\theta}{2}\right) \ket{1}\right) \otimes \left(-\sin\left(\frac{\arccos(t)}{2}\right) \ket{0} + \cos\left(\frac{\arccos(t)}{2}\right) \ket{1}\right)`
    );
  });

  it("normalizes R_z-style labels and preserves the angle expression literally", async () => {
    const result = await renderSymbolicLatex(RZ_ROTATION_CIRCUIT);

    expect(result).toMatchObject({
      success: true,
      envIndex: 0
    });
    if (!result.success) {
      throw new Error(result.error);
    }

    expect(result.latex).toContain(String.raw`\exp\left(i \frac{2\phi+\pi/3}{2}\right) \ket{1}`);
  });

  it("keeps qubit order correct when a controlled rotation branches the upper row", async () => {
    const result = await renderSymbolicLatex(CONTROLLED_RY_ROW_ORDER_CIRCUIT);

    expect(result).toMatchObject({
      success: true,
      envIndex: 0
    });
    if (!result.success) {
      throw new Error(result.error);
    }

    expect(result.latex).toContain(
      String.raw`\ket{\Psi_{1}} &= \left(\cos\left(\frac{\arccos{1/3}}{2}\right) \ket{0} + \sin\left(\frac{\arccos{1/3}}{2}\right) \ket{1}\right) \otimes \ket{1}`
    );
    expect(result.latex).not.toContain(String.raw`\ket{10}`);
  });

  it("propagates controls through symbolic R_y branches and simplifies 2 arccos sqrt angles", async () => {
    const result = await renderSymbolicLatex(CONTROLLED_RY_CASCADE_CIRCUIT);

    expect(result).toMatchObject({
      success: true,
      envIndex: 0
    });
    if (!result.success) {
      throw new Error(result.error);
    }

    expect(result.latex).toContain(
      String.raw`\ket{\Psi_{1}} &= \ket{0} \otimes \left(\sqrt{a} \ket{0} + \sqrt{1 - a} \ket{1}\right)`
    );
    expect(result.latex).toContain(
      String.raw`\ket{\Psi_{2}} &= \sqrt{a} \ket{00} + \sqrt{(1 - a) b} \ket{01} + \sqrt{(1 - a) (1 - b)} \ket{11}`
    );
    expect(result.latex).toContain(
      String.raw`\ket{\Psi_{3}} &= \sqrt{a} \ket{00} + \sqrt{(1 - a) b} \ket{01} + \sqrt{(1 - a) (1 - b)} \ket{10}`
    );
  });

  it("uses trailing lstick subscripts as wire names in symbolic slice text", async () => {
    const result = await renderSymbolicLatex(NAMED_WIRE_CONTROLLED_RY_CASCADE_CIRCUIT);

    expect(result).toMatchObject({
      success: true,
      envIndex: 0
    });
    if (!result.success) {
      throw new Error(result.error);
    }

    expect(result.latex).toContain(String.raw`\ket{\Psi_{0}} &= \ket{0}_{c_0} \otimes \ket{0}_{c_1}`);
    expect(result.latex).toContain(
      String.raw`\ket{\Psi_{1}} &= \ket{0}_{c_0} \otimes \left(\sqrt{a} \ket{0} + \sqrt{1 - a} \ket{1}\right)_{c_1}`
    );
    expect(result.latex).toContain(String.raw`\textbf{Slice 3: } controlled $X$ on $c_1$`);
    expect(result.latex).not.toContain(String.raw`\textbf{Slice 3: } controlled $X$ on $a_{1}$`);
  });

  it("simplifies fractional rotation coefficients with the symbolic scalar parser", async () => {
    const result = await renderSymbolicLatex(FRACTIONAL_CONTROLLED_RY_CIRCUIT);

    expect(result).toMatchObject({
      success: true,
      envIndex: 0
    });
    if (!result.success) {
      throw new Error(result.error);
    }

    expect(result.latex).toContain(
      String.raw`\ket{\Psi_{1}} &= \ket{0}_{c_0} \otimes \left(\sqrt{\frac{tN}{\lambda}} \ket{0} + \sqrt{1 - \frac{tN}{\lambda}} \ket{1}\right)_{c_1}`
    );
    expect(result.latex).toContain(
      String.raw`\ket{\Psi_{2}} &= \sqrt{\frac{tN}{\lambda}} \ket{00} + \sqrt{\frac{1}{5} (1 - \frac{tN}{\lambda})} \ket{01} + \sqrt{\frac{4}{5} (1 - \frac{tN}{\lambda})} \ket{11}`
    );
  });

  it("uses named wires in measurement descriptions and probability labels", async () => {
    const result = await renderSymbolicLatex(NAMED_WIRE_MEASUREMENT_CIRCUIT);

    expect(result).toMatchObject({
      success: true,
      envIndex: 0
    });
    if (!result.success) {
      throw new Error(result.error);
    }

    expect(result.latex).toContain(String.raw`\textbf{Slice 1: } measure $c_0$`);
    expect(result.latex).toContain(String.raw`\Pr(c_0=1)=1`);
  }, 15000);

  it("derives measurement probabilities after a symbolic rotation", async () => {
    const result = await renderSymbolicLatex(ROTATED_MEASUREMENT_CIRCUIT);

    expect(result).toMatchObject({
      success: true,
      envIndex: 0
    });
    if (!result.success) {
      throw new Error(result.error);
    }

    expect(result.latex).toContain(
      String.raw`\Pr(q_{0}=0)=\cos^2\left(\frac{\theta}{2}\right)`
    );
    expect(result.latex).toContain(
      String.raw`\Pr(q_{0}=1)=\sin^2\left(\frac{\theta}{2}\right)`
    );
  }, 15000);

  it("keeps exact interference terms when measuring after mixed H and rotation evolution", async () => {
    const result = await renderSymbolicLatex(INTERFERING_ROTATED_MEASUREMENT_CIRCUIT);

    expect(result).toMatchObject({
      success: true,
      envIndex: 0
    });
    if (!result.success) {
      throw new Error(result.error);
    }

    expect(result.latex).toContain(
      String.raw`\Pr(q_{0}=0)=\left|\frac{1}{\sqrt{2}} \cos\left(\frac{\theta}{2}\right) - \frac{1}{\sqrt{2}} \sin\left(\frac{\theta}{2}\right)\right|^2`
    );
    expect(result.latex).toContain(
      String.raw`\Pr(q_{0}=1)=\left|\frac{1}{\sqrt{2}} \sin\left(\frac{\theta}{2}\right) + \frac{1}{\sqrt{2}} \cos\left(\frac{\theta}{2}\right)\right|^2`
    );
  }, 15000);

  it("removes the measured qubit from the post-measurement branch state", async () => {
    const result = await renderSymbolicLatex(POST_MEASUREMENT_REMAINDER_CIRCUIT);

    expect(result).toMatchObject({
      success: true,
      envIndex: 0
    });
    if (!result.success) {
      throw new Error(result.error);
    }

    expect(result.latex).toContain(
      String.raw`\ket{\Psi_{1}} &= \left\{\begin{array}{ll}\frac{1}{\sqrt{2}} \ket{\psi}, & \Pr(q_{0}=0)=\frac{1}{2} \\ \frac{1}{\sqrt{2}} \ket{\psi}, & \Pr(q_{0}=1)=\frac{1}{2}\end{array}\right.`
    );
    expect(result.latex).not.toContain(String.raw`\ket{0} \otimes \ket{\psi}`);
    expect(result.latex).not.toContain(String.raw`\ket{1} \otimes \ket{\psi}`);
  }, 15000);

  it("supports multi-qubit meters and labels the joint computational-basis outcomes", async () => {
    const result = await renderSymbolicLatex(MULTI_QUBIT_MEASUREMENT_CIRCUIT);

    expect(result).toMatchObject({
      success: true,
      envIndex: 0
    });
    if (!result.success) {
      throw new Error(result.error);
    }

    expect(result.latex).toContain(String.raw`\textbf{Slice 1: } measure $q_{0}$, $q_{1}$`);
    expect(result.latex).toContain(String.raw`\Pr(q_{0}=0, q_{1}=0)=\frac{1}{2}`);
    expect(result.latex).toContain(String.raw`\Pr(q_{0}=1, q_{1}=0)=\frac{1}{2}`);
  }, 15000);

  it("keeps evolving each post-measurement outcome through later slices", async () => {
    const result = await renderSymbolicLatex(MID_CIRCUIT_MEASUREMENT_BRANCHING_CIRCUIT);

    expect(result).toMatchObject({
      success: true,
      envIndex: 0
    });
    if (!result.success) {
      throw new Error(result.error);
    }

    expect(result.latex).toContain(String.raw`\textbf{Slice 1: } measure $q_{0}$`);
    expect(result.latex).toContain(String.raw`\textbf{Slice 2: } apply $H$`);
    expect(result.latex).toContain(String.raw`\ket{\Psi_{2}} &= \left\{\begin{array}{ll}`);
    expect(result.latex).toContain(String.raw`\Pr(q_{0}=0)=\frac{1}{2}`);
    expect(result.latex).toContain(String.raw`\Pr(q_{0}=1)=\frac{1}{2}`);
  }, 15000);

  it("expands multiple same-column operations into sequential symbolic steps", async () => {
    const result = await renderSymbolicLatex(SAME_COLUMN_GATES_CIRCUIT);

    expect(result).toMatchObject({
      success: true,
      envIndex: 0
    });
    if (!result.success) {
      throw new Error(result.error);
    }

    expect(result.latex).toContain(String.raw`\textbf{Slice 1, step 1: } apply $H$`);
    expect(result.latex).toContain(String.raw`\textbf{Slice 1, step 2: } apply $X$`);
    expect(result.latex).toContain(String.raw`\textbf{Slice 2: } apply $Z$`);
    expect(result.latex).toContain(
      String.raw`\ket{\Psi_{1}} &= \left(\frac{1}{\sqrt{2}} \ket{0} + \frac{1}{\sqrt{2}} \ket{1}\right) \otimes \ket{1}`
    );
    expect(result.latex).toContain(
      String.raw`\ket{\Psi_{2}} &= \left(\frac{1}{\sqrt{2}} \ket{0} + \frac{1}{\sqrt{2}} \ket{1}\right) \otimes \ket{0}`
    );
    expect(result.latex).toContain(
      String.raw`\ket{\Psi_{3}} &= \left(\frac{1}{\sqrt{2}} \ket{0} - \frac{1}{\sqrt{2}} \ket{1}\right) \otimes \ket{0}`
    );
  });

  it("supports multiwire basis labels and controlled wide gates", async () => {
    const result = await renderSymbolicLatex(WIDE_CONTROLLED_YY_CIRCUIT);

    expect(result).toMatchObject({
      success: true,
      envIndex: 0
    });
    if (!result.success) {
      throw new Error(result.error);
    }

    expect(result.latex).toContain(String.raw`\ket{\Psi_{0}} &= \ket{00} \otimes \ket{1}`);
    expect(result.latex).toContain(String.raw`\textbf{Slice 1: } controlled $YY$`);
    expect(result.latex).toContain(String.raw`\ket{\Psi_{1}} &= i \ket{1} \otimes i \ket{1} \otimes \ket{1}`);
    expect(result.latex).toContain(String.raw`\ket{\Psi_{2}} &= i \ket{1} \otimes i \ket{0} \otimes \ket{1}`);
  });

  it("interprets a wide H as a Hadamard on each covered qubit", async () => {
    const result = await renderSymbolicLatex(WIDE_HADAMARD_CIRCUIT);

    expect(result).toMatchObject({
      success: true,
      envIndex: 0
    });
    if (!result.success) {
      throw new Error(result.error);
    }

    expect(result.latex).toContain(String.raw`\textbf{Slice 1: } apply $H$`);
    expect(result.latex).toContain(
      String.raw`\ket{\Psi_{1}} &= \left(\frac{1}{\sqrt{2}} \ket{0} + \frac{1}{\sqrt{2}} \ket{1}\right) \otimes \left(\frac{1}{\sqrt{2}} \ket{0} + \frac{1}{\sqrt{2}} \ket{1}\right)`
    );
  });

  it("supports a controlled X after a symbolic single-qubit gate", async () => {
    const result = await renderSymbolicLatex(SYMBOLIC_GATE_WITH_LATER_CONTROLLED_X_CIRCUIT);

    expect(result).toMatchObject({
      success: true,
      envIndex: 0
    });
    if (!result.success) {
      throw new Error(result.error);
    }

    expect(result.latex).toContain(String.raw`\textbf{Slice 3: } apply $A$`);
    expect(result.latex).toContain(String.raw`\ket{\Psi_{3}} &= \frac{1}{\sqrt{2}} (\ket{0} \otimes A\ket{0} + \ket{1} \otimes A\ket{1})`);
    expect(result.latex).toContain(String.raw`\textbf{Slice 4: } controlled $X$ on $a_{1}$`);
    expect(result.latex).toContain(String.raw`\ket{\Psi_{4}} &= \frac{1}{\sqrt{2}} (\ket{0} \otimes A\ket{0} + \ket{1} \otimes XA\ket{1})`);
  }, 15000);

  it("keeps multi-control symbolic gates branch-sensitive after prior Hadamards", async () => {
    const result = await renderSymbolicLatex(BRANCHED_MULTI_CONTROLLED_SYMBOLIC_GATE_CIRCUIT);

    expect(result).toMatchObject({
      success: true,
      envIndex: 0
    });
    if (!result.success) {
      throw new Error(result.error);
    }

    expect(result.latex).toContain(String.raw`\textbf{Slice 2: } controlled $A$`);
    expect(result.latex).toContain(
      String.raw`\ket{\Psi_{3}} &= \frac{1}{2} ((\ket{00} + \ket{01} + \ket{10}) \otimes \ket{\psi}_{t} + \ket{11} \otimes A\ket{\psi}_{t})`
    );
  }, 15000);

  it("requires the full mixed control bitstring before applying a controlled gate", async () => {
    const result = await renderSymbolicLatex(MIXED_MULTI_CONTROLLED_GATE_MISMATCH_CIRCUIT);

    expect(result).toMatchObject({
      success: true,
      envIndex: 0
    });
    if (!result.success) {
      throw new Error(result.error);
    }

    expect(result.latex).toContain(String.raw`\textbf{Slice 1: } controlled $X$`);
    expect(result.latex).toContain(
      String.raw`\ket{\Psi_{1}} &= \ket{1}_{c_0} \otimes \ket{1}_{c_1} \otimes \ket{0}_{t}`
    );
    expect(result.latex).not.toContain(
      String.raw`\ket{\Psi_{1}} &= \ket{1}_{c_0} \otimes \ket{1}_{c_1} \otimes \ket{1}_{t}`
    );
  });

  it("requires the full mixed control bitstring before applying a controlled X target", async () => {
    const result = await renderSymbolicLatex(MIXED_MULTI_CONTROLLED_X_MISMATCH_CIRCUIT);

    expect(result).toMatchObject({
      success: true,
      envIndex: 0
    });
    if (!result.success) {
      throw new Error(result.error);
    }

    expect(result.latex).toContain(String.raw`\textbf{Slice 1: } controlled $X$ on $t$`);
    expect(result.latex).toContain(
      String.raw`\ket{\Psi_{1}} &= \ket{1}_{c_0} \otimes \ket{1}_{c_1} \otimes \ket{0}_{t}`
    );
    expect(result.latex).not.toContain(
      String.raw`\ket{\Psi_{1}} &= \ket{1}_{c_0} \otimes \ket{1}_{c_1} \otimes \ket{1}_{t}`
    );
  });

  it("reads an unlabeled Toffoli stack as a controlled X on the third row", async () => {
    const result = await renderSymbolicLatex(UNLABELED_TOFFOLI_CIRCUIT);

    expect(result).toMatchObject({
      success: true,
      envIndex: 0
    });
    if (!result.success) {
      throw new Error(result.error);
    }

    expect(result.latex).toContain(String.raw`\ket{\Psi_{0}} &= \ket{0} \otimes \ket{0} \otimes \ket{0}`);
    expect(result.latex).toContain(String.raw`\textbf{Slice 1: } controlled $X$ on $a_{2}$`);
    expect(result.latex).toContain(String.raw`\ket{\Psi_{1}} &= \ket{0} \otimes \ket{0} \otimes \ket{0}`);
  }, 15000);

  it("handles unlabeled mixed c0 and c1 multi-controlled gates without firing on the wrong bitstring", async () => {
    const result = await renderSymbolicLatex(UNLABELED_MIXED_MULTI_CONTROLLED_GATE_CIRCUIT);

    expect(result).toMatchObject({
      success: true,
      envIndex: 0
    });
    if (!result.success) {
      throw new Error(result.error);
    }

    expect(result.latex).toContain(String.raw`\textbf{Slice 1: } controlled $A$`);
    expect(result.latex).toContain(String.raw`\ket{\Psi_{1}} &= \ket{0} \otimes \ket{0} \otimes \ket{0}`);
    expect(result.latex).not.toContain(String.raw`A\ket{0}`);
  }, 15000);

  it("handles unlabeled all-open multi-controlled X slices on the default zero state", async () => {
    const result = await renderSymbolicLatex(UNLABELED_ALL_OPEN_MULTI_CONTROLLED_X_CIRCUIT);

    expect(result).toMatchObject({
      success: true,
      envIndex: 0
    });
    if (!result.success) {
      throw new Error(result.error);
    }

    expect(result.latex).toContain(String.raw`\textbf{Slice 1: } controlled $X$ on $a_{2}$`);
    expect(result.latex).toContain(String.raw`\ket{\Psi_{1}} &= \ket{0} \otimes \ket{0} \otimes \ket{1}`);
  }, 15000);

  it("applies a varied-order connected target only when the full open-control bitstring matches", async () => {
    const result = await renderSymbolicLatex(VARIED_ORDER_TARGET_TOP_OPEN_CONTROLS_CIRCUIT);

    expect(result).toMatchObject({
      success: true,
      envIndex: 0
    });
    if (!result.success) {
      throw new Error(result.error);
    }

    expect(result.latex).toContain(String.raw`\textbf{Slice 1: } controlled $X$ on $a_{0}$`);
    expect(result.latex).toContain(String.raw`\ket{\Psi_{1}} &= \ket{1} \otimes \ket{0} \otimes \ket{0}`);
  }, 15000);

  it("applies a varied-order connected gate only when the full open-control bitstring matches", async () => {
    const result = await renderSymbolicLatex(VARIED_ORDER_GATE_MIDDLE_OPEN_CONTROLS_CIRCUIT);

    expect(result).toMatchObject({
      success: true,
      envIndex: 0
    });
    if (!result.success) {
      throw new Error(result.error);
    }

    expect(result.latex).toContain(String.raw`\textbf{Slice 1: } controlled $A$`);
    expect(result.latex).toContain(String.raw`\ket{\Psi_{1}} &= \ket{0} \otimes A\ket{0} \otimes \ket{0}`);
  }, 15000);

  it("applies a varied-order connected swap only when the full control bitstring matches", async () => {
    const result = await renderSymbolicLatex(VARIED_ORDER_SWAP_WITH_CONTROL_BELOW_CIRCUIT);

    expect(result).toMatchObject({
      success: true,
      envIndex: 0
    });
    if (!result.success) {
      throw new Error(result.error);
    }

    expect(result.latex).toContain(String.raw`\textbf{Slice 1: } controlled swap between $q_{0}$ and $q_{1}$`);
    expect(result.latex).toContain(String.raw`\ket{\Psi_{1}} &= \ket{1} \otimes \ket{0} \otimes \ket{0}`);
  }, 15000);

  it("applies a varied-order connected measurement only when the full control bitstring matches", async () => {
    const result = await renderSymbolicLatex(VARIED_ORDER_CONTROLLED_MEASURE_MATCH_CIRCUIT);

    expect(result).toMatchObject({
      success: true,
      envIndex: 0
    });
    if (!result.success) {
      throw new Error(result.error);
    }

    expect(result.latex).toContain(String.raw`\textbf{Slice 1: } controlled measure $q_{1}$`);
    expect(result.latex).toContain(String.raw`\Pr(q_{1}=1)=1`);
  }, 15000);

  it("leaves a varied-order connected measurement idle when the required control bitstring does not match", async () => {
    const result = await renderSymbolicLatex(VARIED_ORDER_CONTROLLED_MEASURE_MISMATCH_CIRCUIT);

    expect(result).toMatchObject({
      success: true,
      envIndex: 0
    });
    if (!result.success) {
      throw new Error(result.error);
    }

    expect(result.latex).toContain(String.raw`\textbf{Slice 1: } controlled measure $q_{1}$`);
    expect(result.latex).toContain(String.raw`\ket{\Psi_{1}} &= \ket{1} \otimes \ket{0} \otimes \ket{0}`);
    expect(result.latex).not.toContain(String.raw`\Pr(q_{1}=0)`);
  }, 15000);
});
