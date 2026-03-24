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

  it("supports a swap slice", async () => {
    const result = await renderSymbolicLatex(SWAP_CIRCUIT);

    expect(result).toMatchObject({
      success: true,
      envIndex: 0,
      latex: expect.stringContaining(String.raw`\textbf{Slice 1: } swap $q_{0}$ and $q_{1}$`)
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

    expect(result.latex).toContain(String.raw`\ket{\Psi_{1}} &= \frac{1}{\sqrt{2}} (\ket{0} + \ket{1})`);
  });

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
    expect(result.latex).toContain(String.raw`\ket{\Psi_{1}} &= \frac{1}{\sqrt{2}} (\ket{01} + \ket{11})`);
    expect(result.latex).toContain(String.raw`\ket{\Psi_{2}} &= \frac{1}{\sqrt{2}} (\ket{00} + \ket{10})`);
    expect(result.latex).toContain(String.raw`\ket{\Psi_{3}} &= \frac{1}{\sqrt{2}} \ket{00} - \frac{1}{\sqrt{2}} \ket{10}`);
  });

  it("propagates unsupported-circuit errors from the Python engine", async () => {
    const result = await renderSymbolicLatex(UNLABELED_NO_OP_CIRCUIT);

    expect(result).toMatchObject({
      success: false,
      statusCode: 400,
      error: expect.stringContaining("No labeled input rows were found")
    });
  });
});
