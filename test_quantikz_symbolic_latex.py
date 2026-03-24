import pathlib
import subprocess
import sys
import tempfile
import textwrap
import unittest


REPO_ROOT = pathlib.Path(__file__).resolve().parent
SCRIPT_PATH = REPO_ROOT / "quantikz_symbolic_latex.py"


AND_CIRCUIT = textwrap.dedent(
    r"""
    \begin{quantikz}[row sep={0.9cm,between origins}, column sep=0.7cm]
    \lstick{$\ket{+}_{c_0}$} & \control{} \wire[d][2]{q} &  & \control{} \wire[d][2]{q} &  \\
    \lstick{$\ket{+}_{c_1}$} & \control{} &  & \control{} &  \\
     & \wireoverride{n} & \ctrl{1} &  & \wireoverride{n} \\
    \lstick{$\ket{\psi}$} &  & \gate{A} &  &
    \end{quantikz}
    """
).strip()

MIXED_CONTROL_CIRCUIT = textwrap.dedent(
    r"""
    \begin{quantikz}[row sep={0.9cm,between origins}, column sep=0.7cm]
    \lstick{$\ket{+}_{c_0}$} & \control{} \wire[d][2]{q} &  & \ctrl{2} &  & \control{} \wire[d][2]{q} &  \\
    \lstick{$\ket{+}_{c_1}$} & \ocontrol{} &  &  &  & \control{} &  \\
     & \wireoverride{n} & \ctrl{1} & \targ{} & \ctrl{1} &  & \wireoverride{n} \\
    \lstick{$\ket{\psi}$} &  & \gate{A} &  & \gate{B} &  &
    \end{quantikz}
    """
).strip()

NO_OP_CIRCUIT = textwrap.dedent(
    r"""
    \begin{quantikz}[row sep={0.9cm,between origins}, column sep=0.7cm]
    \lstick{$\ket{a}$} &  &  &  \\
    \lstick{$\ket{b}$} &  &  &  \\
    \lstick{$\ket{c}$} &  &  &
    \end{quantikz}
    """
).strip()

SWAP_CIRCUIT = textwrap.dedent(
    r"""
    \begin{quantikz}[row sep={0.9cm,between origins}, column sep=0.7cm]
    \lstick{$\ket{+}_{c_0}$} & \swap{1} &  \\
    \lstick{$\ket{+}_{c_1}$} & \targX{} &
    \end{quantikz}
    """
).strip()

NESTED_ANCILLA_CIRCUIT = textwrap.dedent(
    r"""
    \begin{quantikz}[row sep={0.9cm,between origins}, column sep=0.7cm]
    \lstick{$\ket{+}_{c_0}$} & \control{} \wire[d][2]{q} &  &  &  &  &  & \control{} \wire[d][2]{q} & \control{} \wire[d][4]{q} &  & \control{} \wire[d][4]{q} & \ctrl{5} &  \\
    \lstick{$\ket{+}_{c_1}$} & \control{} &  &  &  &  &  & \ocontrol{} &  &  &  &  &  \\
     & \wireoverride{n} & \control{} \wire[d][2]{q} &  & \ctrl{2} &  & \control{} \wire[d][2]{q} &  & \setwiretype{n} &  &  &  &  \\
    \lstick{$\ket{+}_{c_2}$} &  & \control{} &  &  &  & \ocontrol{} &  & \control{} &  & \control{} &  &  \\
     & \setwiretype{n} &  & \ctrl{4} \setwiretype{q} & \targ{} & \ctrl{2} &  & \setwiretype{n} &  & \ctrl{3} \setwiretype{q} &  & \setwiretype{n} &  \\
    \lstick{$\ket{\psi_0}$} &  &  &  &  &  &  &  &  &  &  & \gate{A} &  \\
    \lstick{$\ket{\psi_1}$} &  &  &  &  & \gate{A} &  &  &  &  &  &  &  \\
    \lstick{$\ket{\psi_2}$} &  &  &  &  &  &  &  &  & \gate{A} &  &  &  \\
    \lstick{$\ket{\psi_3}$} &  &  & \gate{A} &  &  &  &  &  &  &  &  &
    \end{quantikz}
    """
).strip()

MEASUREMENT_CIRCUIT = textwrap.dedent(
    r"""
    \begin{quantikz}[row sep={0.9cm,between origins}, column sep=0.7cm]
    \lstick{$\ket{+}_c$} & \control{} \wire[d][2]{q} &  & \ctrl{2} &  & \control{} \wire[d][2]{q} &  &  &  \\
    \lstick{$\ket{+}_0$} & \control{} &  &  &  & \ocontrol{} & \gate{H} & \meter{} \\
     & \setwiretype{n} & \ctrl{1} \setwiretype{q} & \targ{} & \ctrl{1} &  & \setwiretype{n} &  &  \\
    \lstick{$\ket{\psi}$} &  & \gate[wires=2]{XX} &  & \gate[wires=2]{YY} &  &  &  &  \\
    \lstick{$\ket{\phi}$} &  &  &  &  &  &  &  &
    \end{quantikz}
    """
).strip()

HADAMARD_DOUBLE_CIRCUIT = textwrap.dedent(
    r"""
    \begin{quantikz}
    \lstick{$\ket{0}$} & \gate{H} & \gate{H}
    \end{quantikz}
    """
).strip()

XZ_CIRCUIT = textwrap.dedent(
    r"""
    \begin{quantikz}
    \lstick{$\ket{0}$} & \gate{X} & \gate{Z}
    \end{quantikz}
    """
).strip()

S_CIRCUIT = textwrap.dedent(
    r"""
    \begin{quantikz}
    \lstick{$\ket{1}$} & \gate{S}
    \end{quantikz}
    """
).strip()

Y_CIRCUIT = textwrap.dedent(
    r"""
    \begin{quantikz}
    \lstick{$\ket{0}$} & \gate{Y}
    \end{quantikz}
    """
).strip()

Z_PLUS_CIRCUIT = textwrap.dedent(
    r"""
    \begin{quantikz}
    \lstick{$\ket{+}$} & \gate{Z}
    \end{quantikz}
    """
).strip()

SAME_COLUMN_GATES_CIRCUIT = textwrap.dedent(
    r"""
    \begin{quantikz}
    \lstick{$\ket{0}$} & \gate{H} & \gate{Z} \\
    \lstick{$\ket{1}$} & \gate{X} &
    \end{quantikz}
    """
).strip()


class QuantikzSymbolicLatexTests(unittest.TestCase):
    def test_generates_discursive_block_for_compute_and_uncompute_pattern(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            input_path = pathlib.Path(temp_dir) / "and_example.tex"
            input_path.write_text(AND_CIRCUIT, encoding="utf-8")

            result = subprocess.run(
                [sys.executable, str(SCRIPT_PATH), str(input_path)],
                check=True,
                capture_output=True,
                text=True,
            )

        output = result.stdout
        self.assertIn(r"\begin{equation*}", output)
        self.assertIn(r"\ket{\Psi_{0}} &= \ket{+}_{c_0} \otimes \ket{+}_{c_1} \otimes \ket{\psi}", output)
        self.assertIn(r"\ket{\Psi_{1}} &= \frac{1}{2} (\ket{000} + \ket{010} + \ket{100} + \ket{111}) \otimes \ket{\psi}", output)
        self.assertIn(r"(\ket{000} + \ket{010} + \ket{100}) \otimes \ket{\psi} + \ket{111} \otimes A\ket{\psi}", output)
        self.assertIn(r"(\ket{00} + \ket{01} + \ket{10}) \otimes \ket{\psi} + \ket{11} \otimes A\ket{\psi}", output)
        self.assertIn(r"\textbf{Slice 1: } compute AND into ancilla $a_{2}$", output)
        self.assertIn(r"\textbf{Slice 3: } uncompute AND and remove ancilla $a_{2}$", output)

    def test_handles_open_control_and_intermediate_controlled_x(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            input_path = pathlib.Path(temp_dir) / "mixed_controls.tex"
            input_path.write_text(MIXED_CONTROL_CIRCUIT, encoding="utf-8")

            result = subprocess.run(
                [sys.executable, str(SCRIPT_PATH), str(input_path)],
                check=True,
                capture_output=True,
                text=True,
            )

        output = result.stdout
        self.assertIn(r"\ket{\Psi_{1}} &= \frac{1}{2} (\ket{000} + \ket{010} + \ket{101} + \ket{110}) \otimes \ket{\psi}", output)
        self.assertIn(r"\ket{101} \otimes A\ket{\psi}", output)
        self.assertIn(r"\textbf{Slice 3: } controlled $X$ on $a_{2}$", output)
        self.assertIn(r"\ket{111} \otimes B\ket{\psi}", output)
        self.assertIn(r"\ket{\Psi_{5}} &= \frac{1}{2} ((\ket{00} + \ket{01}) \otimes \ket{\psi} + \ket{10} \otimes A\ket{\psi} + \ket{11} \otimes B\ket{\psi})", output)

    def test_returns_initial_state_for_label_only_circuit(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            input_path = pathlib.Path(temp_dir) / "noop.tex"
            input_path.write_text(NO_OP_CIRCUIT, encoding="utf-8")

            result = subprocess.run(
                [sys.executable, str(SCRIPT_PATH), str(input_path)],
                check=True,
                capture_output=True,
                text=True,
            )

        output = result.stdout
        self.assertIn(r"\begin{equation*}", output)
        self.assertIn(r"\ket{\Psi_{0}} &= \ket{a} \otimes \ket{b} \otimes \ket{c}", output)
        self.assertNotIn(r"\textbf{Slice 1: }", output)

    def test_supports_swap_slice(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            input_path = pathlib.Path(temp_dir) / "swap.tex"
            input_path.write_text(SWAP_CIRCUIT, encoding="utf-8")

            result = subprocess.run(
                [sys.executable, str(SCRIPT_PATH), str(input_path)],
                check=True,
                capture_output=True,
                text=True,
            )

        output = result.stdout
        self.assertIn(r"\ket{\Psi_{0}} &= \ket{+}_{c_0} \otimes \ket{+}_{c_1}", output)
        self.assertIn(r"\ket{\Psi_{1}} &= \frac{1}{2} (\ket{00} + \ket{01} + \ket{10} + \ket{11})", output)
        self.assertIn(r"\textbf{Slice 1: } swap $q_{0}$ and $q_{1}$", output)

    def test_supports_nested_blank_ancilla_rows(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            input_path = pathlib.Path(temp_dir) / "nested_ancilla.tex"
            input_path.write_text(NESTED_ANCILLA_CIRCUIT, encoding="utf-8")

            result = subprocess.run(
                [sys.executable, str(SCRIPT_PATH), str(input_path)],
                check=True,
                capture_output=True,
                text=True,
            )

        output = result.stdout
        self.assertIn(r"\textbf{Slice 2: } compute AND into ancilla $a_{4}$", output)
        self.assertIn(r"\textbf{Slice 6: } uncompute AND and remove ancilla $a_{4}$", output)
        self.assertIn(r"\textbf{Slice 7: } uncompute AND and remove ancilla $a_{2}$", output)
        self.assertIn(r"\textbf{Slice 8: } compute AND into ancilla $a_{4}$", output)
        self.assertIn(r"\textbf{Slice 10: } uncompute AND and remove ancilla $a_{4}$", output)
        self.assertIn(r"\ket{11101} \otimes \ket{\psi_0} \otimes A\ket{\psi_1}", output)
        self.assertIn(r"\ket{101} \otimes \ket{\psi_0} \otimes \ket{\psi_1} \otimes A\ket{\psi_2}", output)

    def test_renders_measurement_branches_as_a_braced_list(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            input_path = pathlib.Path(temp_dir) / "measurement.tex"
            input_path.write_text(MEASUREMENT_CIRCUIT, encoding="utf-8")

            result = subprocess.run(
                [sys.executable, str(SCRIPT_PATH), str(input_path)],
                check=True,
                capture_output=True,
                text=True,
            )

        output = result.stdout
        self.assertIn(r"\ket{\Psi_{7}} &= \left\{\begin{array}{ll}", output)
        self.assertIn(r"\Pr(q_{1}=0)=\frac{3}{4}", output)
        self.assertIn(r"\Pr(q_{1}=1)=\frac{1}{4}", output)
        self.assertNotIn(r"\underbrace{", output)
        self.assertIn(r"\textbf{Slice 7: } measure $q_{1}$", output)

    def test_applies_hadamard_to_basis_states_and_recombines_duplicate_terms(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            input_path = pathlib.Path(temp_dir) / "hadamard_double.tex"
            input_path.write_text(HADAMARD_DOUBLE_CIRCUIT, encoding="utf-8")

            result = subprocess.run(
                [sys.executable, str(SCRIPT_PATH), str(input_path)],
                check=True,
                capture_output=True,
                text=True,
            )

        output = result.stdout
        self.assertIn(r"\ket{\Psi_{1}} &= \frac{1}{\sqrt{2}} (\ket{0} + \ket{1})", output)
        self.assertIn(r"\ket{\Psi_{2}} &= \ket{0}", output)

    def test_applies_named_pauli_and_phase_gates_to_basis_states(self) -> None:
        circuits = [
            ("xz.tex", XZ_CIRCUIT, [r"\ket{\Psi_{1}} &= \ket{1}", r"\ket{\Psi_{2}} &= -\ket{1}"]),
            ("s.tex", S_CIRCUIT, [r"\ket{\Psi_{1}} &= i \ket{1}"]),
            ("y.tex", Y_CIRCUIT, [r"\ket{\Psi_{1}} &= i \ket{1}"]),
            (
                "z_plus.tex",
                Z_PLUS_CIRCUIT,
                [r"\ket{\Psi_{1}} &= \frac{1}{\sqrt{2}} \ket{0} - \frac{1}{\sqrt{2}} \ket{1}"],
            ),
        ]

        for filename, circuit, expected_snippets in circuits:
            with self.subTest(filename=filename):
                with tempfile.TemporaryDirectory() as temp_dir:
                    input_path = pathlib.Path(temp_dir) / filename
                    input_path.write_text(circuit, encoding="utf-8")

                    result = subprocess.run(
                        [sys.executable, str(SCRIPT_PATH), str(input_path)],
                        check=True,
                        capture_output=True,
                        text=True,
                    )

                output = result.stdout
                for expected in expected_snippets:
                    self.assertIn(expected, output)

    def test_expands_multiple_same_column_operations_into_separate_steps(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            input_path = pathlib.Path(temp_dir) / "same_column.tex"
            input_path.write_text(SAME_COLUMN_GATES_CIRCUIT, encoding="utf-8")

            result = subprocess.run(
                [sys.executable, str(SCRIPT_PATH), str(input_path)],
                check=True,
                capture_output=True,
                text=True,
            )

        output = result.stdout
        self.assertIn(r"\textbf{Slice 1, step 1: } apply $H$", output)
        self.assertIn(r"\textbf{Slice 1, step 2: } apply $X$", output)
        self.assertIn(r"\textbf{Slice 2: } apply $Z$", output)
        self.assertIn(r"\ket{\Psi_{1}} &= \frac{1}{\sqrt{2}} (\ket{01} + \ket{11})", output)
        self.assertIn(r"\ket{\Psi_{2}} &= \frac{1}{\sqrt{2}} (\ket{00} + \ket{10})", output)
        self.assertIn(r"\ket{\Psi_{3}} &= \frac{1}{\sqrt{2}} \ket{00} - \frac{1}{\sqrt{2}} \ket{10}", output)


if __name__ == "__main__":
    unittest.main()
