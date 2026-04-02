import json
import pathlib
import subprocess
import sys
import unittest

import quantikz_statevector_evolution as evolution


REPO_ROOT = pathlib.Path(__file__).resolve().parent
EXAMPLE_PATH = REPO_ROOT / "quantikz_example.tex"
SCRIPT_PATH = REPO_ROOT / "quantikz_statevector_evolution.py"
WIDE_CONTROLLED_YY_CIRCUIT = r"""
\begin{quantikz}[row sep={0.9cm,between origins}, column sep=0.7cm]
\lstick[wires=2,braces=none]{$\ket{00}$} & \gate[wires=2]{YY} &  & \\
 & \wire[d][1]{q} & \gate{X} & \\
\lstick{$\ket{1}$} & \control{} &  &
\end{quantikz}
"""
WIDE_HADAMARD_CIRCUIT = r"""
\begin{quantikz}
\lstick[wires=2]{$\ket{00}$} & \gate[wires=2]{H} \\
 &
\end{quantikz}
"""
SPECIAL_STATE_CIRCUITS = {
    "plus": (
        r"""
\begin{quantikz}
\lstick{$\ket{+}$} & \gate{Z}
\end{quantikz}
""",
        "1/sqrt(2)|0> - 1/sqrt(2)|1>",
    ),
    "minus": (
        r"""
\begin{quantikz}
\lstick{$\ket{-}$} & \gate{X}
\end{quantikz}
""",
        "-1/sqrt(2)|0> + 1/sqrt(2)|1>",
    ),
    "i": (
        r"""
\begin{quantikz}
\lstick{$\ket{i}$} & \gate{Z}
\end{quantikz}
""",
        "1/sqrt(2)|0> - i/sqrt(2)|1>",
    ),
    "-i": (
        r"""
\begin{quantikz}
\lstick{$\ket{-i}$} & \gate{Z}
\end{quantikz}
""",
        "1/sqrt(2)|0> + i/sqrt(2)|1>",
    ),
    "T": (
        r"""
\begin{quantikz}
\lstick{$\ket{T}$} & \gate{Z}
\end{quantikz}
""",
        "1/sqrt(2)|0> - ((1 + i)/2)|1>",
    ),
}

SDG_CIRCUIT = r"""
\begin{quantikz}
\lstick{$\ket{1}$} & \gate{S^\dagger}
\end{quantikz}
"""


class QuantikzStatevectorEvolutionTests(unittest.TestCase):
    def test_parses_all_example_circuits(self) -> None:
        evolutions = evolution.symbolic_evolution_for_file(EXAMPLE_PATH)

        self.assertEqual(len(evolutions), 10)
        self.assertTrue(all(item.title for item in evolutions))
        self.assertEqual([len(item.slices) for item in evolutions], [3, 3, 3, 3, 4, 2, 3, 3, 4, 1])

    def test_expands_baseline_single_qubit_path(self) -> None:
        baseline = evolution.symbolic_evolution_for_file(EXAMPLE_PATH)[0]

        self.assertEqual(baseline.initial_state, r"\ket{0}")
        self.assertEqual([slice_evolution.operations for slice_evolution in baseline.slices], [
            ["H(q0)"],
            ["Z(q0)"],
            ["Measure(q0)"],
        ])
        self.assertEqual(
            baseline.slices[0].expanded_state,
            "1/sqrt(2)|0> + 1/sqrt(2)|1>",
        )
        self.assertIn("|1>", baseline.slices[1].expanded_state or "")
        self.assertEqual(
            [
                (outcome.outcome, outcome.probability, outcome.remaining_state)
                for outcome in baseline.slices[2].measurement_outcomes
            ],
            [
                ("0", "1/2", None),
                ("1", "1/2", None),
            ],
        )
        self.assertIn("Outcome q0=0 with probability 1/2", baseline.slices[2].state)

    def test_tracks_slice_labels_entangling_gate_and_classical_control(self) -> None:
        evolutions = evolution.symbolic_evolution_for_file(EXAMPLE_PATH)
        framed = evolutions[8]
        classical = evolutions[5]

        self.assertEqual(framed.slices[0].labels, ["init"])
        self.assertEqual(framed.slices[0].operations, ["H(q0)", "S(q1)"])
        self.assertEqual(framed.slices[1].operations, ["MCX(q0=1 -> q1)"])
        self.assertEqual(framed.slices[2].labels, ["phase"])
        self.assertEqual(framed.slices[2].operations, [r"R_Z(\theta)(q0)", r"T^{\dagger}(q1)"])

        self.assertEqual(classical.slices[1].operations, ["Measure(q0)", "cX(m(q0) -> q1)"])
        self.assertTrue(any("classical control treated symbolically" in note for note in classical.slices[1].notes))

    def test_partial_measurement_reports_outcomes_and_remaining_state(self) -> None:
        source = r"""
\begin{quantikz}
\lstick{\ket{0}} & \gate{H} & \ctrl{1} & \meter{} \\
\lstick{\ket{0}} &          & \targ{}  & \qw
\end{quantikz}
"""

        bell = evolution.symbolic_evolution_for_source(source)[0]
        measurement_slice = bell.slices[2]

        self.assertEqual(measurement_slice.operations, ["Measure(q0)"])
        self.assertEqual(
            [
                (
                    outcome.outcome,
                    outcome.measured_qubits,
                    outcome.remaining_qubits,
                    outcome.probability,
                    outcome.remaining_state,
                )
                for outcome in measurement_slice.measurement_outcomes
            ],
            [
                ("0", [0], [1], "1/2", "|0>"),
                ("1", [0], [1], "1/2", "|1>"),
            ],
        )
        self.assertIn("remaining state on q1: |0>", measurement_slice.state)

    def test_expands_multiwire_initial_states_and_controlled_wide_gates(self) -> None:
        evolution_result = evolution.symbolic_evolution_for_source(WIDE_CONTROLLED_YY_CIRCUIT)[0]

        self.assertEqual(evolution_result.initial_state, r"\ket{00}_{q0,q1} x \ket{1}")
        self.assertEqual(
            [slice_evolution.operations for slice_evolution in evolution_result.slices],
            [["C[q2=1] YY(q0,q1)"], ["X(q1)"]],
        )
        self.assertEqual(evolution_result.slices[0].expanded_state, "-|111>")
        self.assertEqual(evolution_result.slices[1].expanded_state, "-|101>")

    def test_expands_plus_minus_i_minus_i_and_t_initial_states(self) -> None:
        for name, (source, expected_state) in SPECIAL_STATE_CIRCUITS.items():
            with self.subTest(name=name):
                evolution_result = evolution.symbolic_evolution_for_source(source)[0]
                self.assertEqual(evolution_result.slices[0].expanded_state, expected_state)

    def test_supports_s_dagger_phase_gate(self) -> None:
        evolution_result = evolution.symbolic_evolution_for_source(SDG_CIRCUIT)[0]
        self.assertEqual(evolution_result.slices[0].expanded_state, "exp(-i*pi/2)|1>")

    def test_interprets_wide_h_as_hadamard_on_each_qubit(self) -> None:
        evolution_result = evolution.symbolic_evolution_for_source(WIDE_HADAMARD_CIRCUIT)[0]

        self.assertEqual(evolution_result.slices[0].operations, ["H(q0,q1)"])
        expanded_state = evolution_result.slices[0].expanded_state or ""
        for basis_state in ("|00>", "|01>", "|10>", "|11>"):
            self.assertIn(basis_state, expanded_state)

    def test_cli_json_output_handles_env_index(self) -> None:
        result = subprocess.run(
            [sys.executable, str(SCRIPT_PATH), str(EXAMPLE_PATH), "--env-index", "7", "--json"],
            check=True,
            capture_output=True,
            text=True,
        )

        payload = json.loads(result.stdout)
        self.assertEqual(len(payload), 1)
        self.assertEqual(payload[0]["title"], "8. Swap ladder into a wide three-wire operation")
        self.assertEqual(payload[0]["slices"][0]["operations"], ["SWAP(q0, q2)"])
        self.assertEqual(payload[0]["slices"][1]["operations"], [r"\mathrm{SELECT}(x)(q0,q1,q2)"])

    def test_json_output_includes_measurement_outcomes(self) -> None:
        payload = evolution.evolution_to_dict(evolution.symbolic_evolution_for_file(EXAMPLE_PATH)[0])

        self.assertEqual(
            payload["slices"][2]["measurement_outcomes"],
            [
                {
                    "outcome": "0",
                    "measured_qubits": [0],
                    "remaining_qubits": [],
                    "probability": "1/2",
                    "remaining_state": None,
                },
                {
                    "outcome": "1",
                    "measured_qubits": [0],
                    "remaining_qubits": [],
                    "probability": "1/2",
                    "remaining_state": None,
                },
            ],
        )

    def test_renders_standalone_latex_report(self) -> None:
        latex = evolution.render_latex_document(evolution.symbolic_evolution_for_file(EXAMPLE_PATH), EXAMPLE_PATH.name)

        self.assertIn(r"\section*{Quantikz Examples With Symbolic Evolution}", latex)
        self.assertIn(r"\subsection*{1. Baseline single-qubit path}", latex)
        self.assertIn(r"\ket{\psi_1} = \frac{1}{\sqrt{2}} \ket{0} + \frac{1}{\sqrt{2}} \ket{1}", latex)
        self.assertIn(r"\mathcal{O}_{2}\ket{\psi_{1}}", latex)
        self.assertIn(r"Outcome \verb|q0=0| with probability \verb|1/2|; remaining state: all qubits measured.", latex)
        self.assertIn(r"\end{document}", latex)


if __name__ == "__main__":
    unittest.main()
