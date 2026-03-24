import pathlib
import subprocess
import sys
import tempfile
import textwrap
import unittest
from quantikz_symbolic_latex import normalize_scalar_latex


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

T_CIRCUIT = textwrap.dedent(
    r"""
    \begin{quantikz}
    \lstick{$\ket{1}$} & \gate{T} & \meter{}
    \end{quantikz}
    """
).strip()

PAULI_ROTATION_CIRCUIT = textwrap.dedent(
    r"""
    \begin{quantikz}
    \lstick{$\ket{0}$} & \gate{R_X(\theta)} \\
    \lstick{$\ket{1}$} & \gate{R_{y}(\arccos(t))}
    \end{quantikz}
    """
).strip()

RZ_ROTATION_CIRCUIT = textwrap.dedent(
    r"""
    \begin{quantikz}
    \lstick{$\ket{1}$} & \gate{R_z(2\phi + \pi/3)}
    \end{quantikz}
    """
).strip()

CONTROLLED_RY_CASCADE_CIRCUIT = textwrap.dedent(
    r"""
    \begin{quantikz}[row sep={0.9cm,between origins}, column sep=0.7cm]
    \lstick{$\ket{0}$} &  & \gate{R_y(2\arccos{\sqrt{b}})} & \ctrl{1} &  \\
    \lstick{$\ket{0}$} & \gate{R_y(2\arccos{\sqrt{a}})} & \ctrl{-1} & \targ{} &
    \end{quantikz}
    """
).strip()

NAMED_WIRE_CONTROLLED_RY_CASCADE_CIRCUIT = textwrap.dedent(
    r"""
    \begin{quantikz}[row sep={0.9cm,between origins}, column sep=0.7cm]
    \lstick{$\ket{0}_{c_0}$} &  & \gate{R_y(2\arccos{\sqrt{b}})} & \ctrl{1} &  \\
    \lstick{$\ket{0}_{c_1}$} & \gate{R_y(2\arccos{\sqrt{a}})} & \ctrl{-1} & \targ{} &
    \end{quantikz}
    """
).strip()

FRACTIONAL_CONTROLLED_RY_CIRCUIT = textwrap.dedent(
    r"""
    \begin{quantikz}[row sep={0.9cm,between origins}, column sep=0.7cm]
    \lstick{$\ket{0}_{c_0}$} &  & \gate{R_y(2\arccos{\sqrt{\frac15}})} & \ctrl{1} &  \\
    \lstick{$\ket{0}_{c_1}$} & \gate{R_y(2\arccos{\sqrt{\frac{tN}{\lambda}}})} & \ctrl{-1} & \targ{} &
    \end{quantikz}
    """
).strip()

NAMED_WIRE_MEASUREMENT_CIRCUIT = textwrap.dedent(
    r"""
    \begin{quantikz}
    \lstick{$\ket{1}_{c_0}$} & \meter{}
    \end{quantikz}
    """
).strip()

ROTATED_MEASUREMENT_CIRCUIT = textwrap.dedent(
    r"""
    \begin{quantikz}
    \lstick{$\ket{0}$} & \gate{R_y(\theta)} & \meter{}
    \end{quantikz}
    """
).strip()

INTERFERING_ROTATED_MEASUREMENT_CIRCUIT = textwrap.dedent(
    r"""
    \begin{quantikz}
    \lstick{$\ket{0}$} & \gate{H} & \gate{R_y(\theta)} & \meter{}
    \end{quantikz}
    """
).strip()

POST_MEASUREMENT_REMAINDER_CIRCUIT = textwrap.dedent(
    r"""
    \begin{quantikz}
    \lstick{$\ket{+}$} & \meter{} \\
    \lstick{$\ket{\psi}$} &
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

WIDE_CONTROLLED_YY_CIRCUIT = textwrap.dedent(
    r"""
    \begin{quantikz}[row sep={0.9cm,between origins}, column sep=0.7cm]
    \lstick[wires=2,braces=none]{$\ket{00}$} & \gate[wires=2]{YY} &  & \\
     & \wire[d][1]{q} & \gate{X} & \\
    \lstick{$\ket{1}$} & \control{} &  &
    \end{quantikz}
    """
).strip()

I_STATE_CIRCUIT = textwrap.dedent(
    r"""
    \begin{quantikz}
    \lstick{$\ket{i}$} & \gate{Z}
    \end{quantikz}
    """
).strip()

WIDE_HADAMARD_CIRCUIT = textwrap.dedent(
    r"""
    \begin{quantikz}
    \lstick[wires=2]{$\ket{00}$} & \gate[wires=2]{H} \\
     &
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
        self.assertIn(
            r"\ket{\Psi_{1}} &= \left(\frac{1}{\sqrt{2}} \ket{0} + \frac{1}{\sqrt{2}} \ket{1}\right)_{c_0} \otimes \left(\frac{1}{\sqrt{2}} \ket{0} + \frac{1}{\sqrt{2}} \ket{1}\right)_{c_1}",
            output,
        )
        self.assertIn(r"\textbf{Slice 1: } swap $c_0$ and $c_1$", output)

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
        self.assertIn(r"\Pr(0=0)=\frac{3}{4}", output)
        self.assertIn(r"\Pr(0=1)=\frac{1}{4}", output)
        self.assertNotIn(r"\underbrace{", output)
        self.assertIn(r"\textbf{Slice 7: } measure $0$", output)

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
        self.assertIn(r"\ket{\Psi_{1}} &= \left(\frac{1}{\sqrt{2}} \ket{0} + \frac{1}{\sqrt{2}} \ket{1}\right)", output)
        self.assertIn(r"\ket{\Psi_{2}} &= \ket{0}", output)

    def test_applies_named_pauli_and_phase_gates_to_basis_states(self) -> None:
        circuits = [
            ("xz.tex", XZ_CIRCUIT, [r"\ket{\Psi_{1}} &= \ket{1}", r"\ket{\Psi_{2}} &= -\ket{1}"]),
            ("s.tex", S_CIRCUIT, [r"\ket{\Psi_{1}} &= i \ket{1}"]),
            ("t.tex", T_CIRCUIT, [r"\ket{\Psi_{1}} &= \frac{1 + i}{\sqrt{2}} \ket{1}", r"\Pr(q_{0}=1)=1"]),
            ("y.tex", Y_CIRCUIT, [r"\ket{\Psi_{1}} &= i \ket{1}"]),
            (
                "z_plus.tex",
                Z_PLUS_CIRCUIT,
                [r"\ket{\Psi_{1}} &= \left(\frac{1}{\sqrt{2}} \ket{0} - \frac{1}{\sqrt{2}} \ket{1}\right)"],
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

    def test_renders_pauli_axis_rotations_as_basis_state_branches(self) -> None:
        circuits = [
            (
                "pauli_rotation.tex",
                PAULI_ROTATION_CIRCUIT,
                [
                    r"\ket{\Psi_{1}} &= \left(\cos\left(\frac{\theta}{2}\right) \ket{0} - i \sin\left(\frac{\theta}{2}\right) \ket{1}\right) \otimes \ket{1}",
                    r"\ket{\Psi_{2}} &= \left(\cos\left(\frac{\theta}{2}\right) \ket{0} - i \sin\left(\frac{\theta}{2}\right) \ket{1}\right) \otimes \left(-\sin\left(\frac{\arccos(t)}{2}\right) \ket{0} + \cos\left(\frac{\arccos(t)}{2}\right) \ket{1}\right)",
                ],
            ),
            (
                "rz_rotation.tex",
                RZ_ROTATION_CIRCUIT,
                [r"\exp\left(i \frac{2\phi+\pi/3}{2}\right) \ket{1}"],
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

    def test_propagates_controls_through_symbolic_ry_branches(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            input_path = pathlib.Path(temp_dir) / "controlled_ry_cascade.tex"
            input_path.write_text(CONTROLLED_RY_CASCADE_CIRCUIT, encoding="utf-8")

            result = subprocess.run(
                [sys.executable, str(SCRIPT_PATH), str(input_path)],
                check=True,
                capture_output=True,
                text=True,
            )

        output = result.stdout
        self.assertIn(r"\ket{\Psi_{1}} &= \ket{0} \otimes \left(\sqrt{a} \ket{0} + \sqrt{1 - a} \ket{1}\right)", output)
        self.assertIn(
            r"\ket{\Psi_{2}} &= \sqrt{a} \ket{00} + \sqrt{(1 - a) b} \ket{01} + \sqrt{(1 - a) (1 - b)} \ket{11}",
            output,
        )
        self.assertIn(
            r"\ket{\Psi_{3}} &= \sqrt{a} \ket{00} + \sqrt{(1 - a) b} \ket{01} + \sqrt{(1 - a) (1 - b)} \ket{10}",
            output,
        )

    def test_uses_lstick_subscripts_as_wire_names(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            input_path = pathlib.Path(temp_dir) / "named_wire_controlled_ry.tex"
            input_path.write_text(NAMED_WIRE_CONTROLLED_RY_CASCADE_CIRCUIT, encoding="utf-8")

            result = subprocess.run(
                [sys.executable, str(SCRIPT_PATH), str(input_path)],
                check=True,
                capture_output=True,
                text=True,
            )

        output = result.stdout
        self.assertIn(r"\ket{\Psi_{0}} &= \ket{0}_{c_0} \otimes \ket{0}_{c_1}", output)
        self.assertIn(
            r"\ket{\Psi_{1}} &= \ket{0}_{c_0} \otimes \left(\sqrt{a} \ket{0} + \sqrt{1 - a} \ket{1}\right)_{c_1}",
            output,
        )
        self.assertIn(r"\textbf{Slice 3: } controlled $X$ on $c_1$", output)
        self.assertNotIn(r"\textbf{Slice 3: } controlled $X$ on $a_{1}$", output)

    def test_simplifies_fractional_rotation_coefficients_with_symbolic_parser(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            input_path = pathlib.Path(temp_dir) / "fractional_controlled_ry.tex"
            input_path.write_text(FRACTIONAL_CONTROLLED_RY_CIRCUIT, encoding="utf-8")

            result = subprocess.run(
                [sys.executable, str(SCRIPT_PATH), str(input_path)],
                check=True,
                capture_output=True,
                text=True,
            )

        output = result.stdout
        self.assertIn(
            r"\ket{\Psi_{1}} &= \ket{0}_{c_0} \otimes \left(\sqrt{\frac{tN}{\lambda}} \ket{0} + \sqrt{1 - \frac{tN}{\lambda}} \ket{1}\right)_{c_1}",
            output,
        )
        self.assertIn(
            r"\ket{\Psi_{2}} &= \sqrt{\frac{tN}{\lambda}} \ket{00} + \sqrt{\frac{1}{5} (1 - \frac{tN}{\lambda})} \ket{01} + \sqrt{\frac{4}{5} (1 - \frac{tN}{\lambda})} \ket{11}",
            output,
        )

    def test_renders_general_nonnegative_radical_products_as_single_roots(self) -> None:
        self.assertEqual(
            normalize_scalar_latex(r"\frac{2}{\sqrt{5}} \sqrt{1 - \frac{tN}{\lambda}}"),
            r"\sqrt{\frac{4}{5} (1 - \frac{tN}{\lambda})}",
        )
        self.assertEqual(
            normalize_scalar_latex(r"\frac{1}{3} \sqrt{x}"),
            r"\sqrt{\frac{1}{9} x}",
        )
        self.assertEqual(
            normalize_scalar_latex(r"a \frac{2}{\sqrt{5}} \sqrt{x}"),
            r"a \sqrt{\frac{4}{5} x}",
        )

    def test_uses_wire_names_for_measurements(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            input_path = pathlib.Path(temp_dir) / "named_wire_measurement.tex"
            input_path.write_text(NAMED_WIRE_MEASUREMENT_CIRCUIT, encoding="utf-8")

            result = subprocess.run(
                [sys.executable, str(SCRIPT_PATH), str(input_path)],
                check=True,
                capture_output=True,
                text=True,
            )

        output = result.stdout
        self.assertIn(r"\textbf{Slice 1: } measure $c_0$", output)
        self.assertIn(r"\Pr(c_0=1)=1", output)

    def test_derives_measurement_probabilities_after_rotations(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            input_path = pathlib.Path(temp_dir) / "rotated_measurement.tex"
            input_path.write_text(ROTATED_MEASUREMENT_CIRCUIT, encoding="utf-8")

            result = subprocess.run(
                [sys.executable, str(SCRIPT_PATH), str(input_path)],
                check=True,
                capture_output=True,
                text=True,
            )

        output = result.stdout
        self.assertIn(r"\Pr(q_{0}=0)=\cos^2\left(\frac{\theta}{2}\right)", output)
        self.assertIn(r"\Pr(q_{0}=1)=\sin^2\left(\frac{\theta}{2}\right)", output)

    def test_keeps_exact_interference_terms_in_rotated_measurements(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            input_path = pathlib.Path(temp_dir) / "interfering_rotated_measurement.tex"
            input_path.write_text(INTERFERING_ROTATED_MEASUREMENT_CIRCUIT, encoding="utf-8")

            result = subprocess.run(
                [sys.executable, str(SCRIPT_PATH), str(input_path)],
                check=True,
                capture_output=True,
                text=True,
            )

        output = result.stdout
        self.assertIn(
            r"\Pr(q_{0}=0)=\left|\frac{1}{\sqrt{2}} \cos\left(\frac{\theta}{2}\right) - \frac{1}{\sqrt{2}} \sin\left(\frac{\theta}{2}\right)\right|^2",
            output,
        )
        self.assertIn(
            r"\Pr(q_{0}=1)=\left|\frac{1}{\sqrt{2}} \sin\left(\frac{\theta}{2}\right) + \frac{1}{\sqrt{2}} \cos\left(\frac{\theta}{2}\right)\right|^2",
            output,
        )

    def test_removes_measured_qubits_from_branch_states(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            input_path = pathlib.Path(temp_dir) / "post_measurement_remainder.tex"
            input_path.write_text(POST_MEASUREMENT_REMAINDER_CIRCUIT, encoding="utf-8")

            result = subprocess.run(
                [sys.executable, str(SCRIPT_PATH), str(input_path)],
                check=True,
                capture_output=True,
                text=True,
            )

        output = result.stdout
        self.assertIn(
            r"\ket{\Psi_{1}} &= \left\{\begin{array}{ll}\frac{1}{\sqrt{2}} \ket{\psi}, & \Pr(q_{0}=0)=\frac{1}{2} \\ \frac{1}{\sqrt{2}} \ket{\psi}, & \Pr(q_{0}=1)=\frac{1}{2}\end{array}\right.",
            output,
        )
        self.assertNotIn(r"\ket{0} \otimes \ket{\psi}", output)
        self.assertNotIn(r"\ket{1} \otimes \ket{\psi}", output)

    def test_supports_multiwire_basis_labels_and_controlled_wide_gates(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            input_path = pathlib.Path(temp_dir) / "wide_controlled_yy.tex"
            input_path.write_text(WIDE_CONTROLLED_YY_CIRCUIT, encoding="utf-8")

            result = subprocess.run(
                [sys.executable, str(SCRIPT_PATH), str(input_path)],
                check=True,
                capture_output=True,
                text=True,
            )

        output = result.stdout
        self.assertIn(r"\ket{\Psi_{0}} &= \ket{00} \otimes \ket{1}", output)
        self.assertIn(r"\textbf{Slice 1: } controlled $YY$", output)
        self.assertIn(r"\ket{\Psi_{1}} &= i \ket{1} \otimes i \ket{1} \otimes \ket{1}", output)
        self.assertIn(r"\ket{\Psi_{2}} &= i \ket{1} \otimes i \ket{0} \otimes \ket{1}", output)

    def test_supports_i_basis_state(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            input_path = pathlib.Path(temp_dir) / "i_state.tex"
            input_path.write_text(I_STATE_CIRCUIT, encoding="utf-8")

            result = subprocess.run(
                [sys.executable, str(SCRIPT_PATH), str(input_path)],
                check=True,
                capture_output=True,
                text=True,
            )

        output = result.stdout
        self.assertIn(r"\ket{\Psi_{1}} &= \left(\frac{1}{\sqrt{2}} \ket{0} - \frac{i}{\sqrt{2}} \ket{1}\right)", output)

    def test_interprets_wide_h_as_hadamard_on_each_qubit(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            input_path = pathlib.Path(temp_dir) / "wide_h.tex"
            input_path.write_text(WIDE_HADAMARD_CIRCUIT, encoding="utf-8")

            result = subprocess.run(
                [sys.executable, str(SCRIPT_PATH), str(input_path)],
                check=True,
                capture_output=True,
                text=True,
            )

        output = result.stdout
        self.assertIn(r"\textbf{Slice 1: } apply $H$", output)
        self.assertIn(
            r"\ket{\Psi_{1}} &= \left(\frac{1}{\sqrt{2}} \ket{0} + \frac{1}{\sqrt{2}} \ket{1}\right) \otimes \left(\frac{1}{\sqrt{2}} \ket{0} + \frac{1}{\sqrt{2}} \ket{1}\right)",
            output,
        )

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
        self.assertIn(r"\ket{\Psi_{1}} &= \left(\frac{1}{\sqrt{2}} \ket{0} + \frac{1}{\sqrt{2}} \ket{1}\right) \otimes \ket{1}", output)
        self.assertIn(r"\ket{\Psi_{2}} &= \left(\frac{1}{\sqrt{2}} \ket{0} + \frac{1}{\sqrt{2}} \ket{1}\right) \otimes \ket{0}", output)
        self.assertIn(r"\ket{\Psi_{3}} &= \left(\frac{1}{\sqrt{2}} \ket{0} - \frac{1}{\sqrt{2}} \ket{1}\right) \otimes \ket{0}", output)


if __name__ == "__main__":
    unittest.main()
