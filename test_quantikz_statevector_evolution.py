import json
import pathlib
import subprocess
import sys
import unittest

import quantikz_statevector_evolution as evolution


REPO_ROOT = pathlib.Path(__file__).resolve().parent
EXAMPLE_PATH = REPO_ROOT / "quantikz_example.tex"
SCRIPT_PATH = REPO_ROOT / "quantikz_statevector_evolution.py"


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
        self.assertIn("Measure(q0)", baseline.slices[2].state)

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

    def test_renders_standalone_latex_report(self) -> None:
        latex = evolution.render_latex_document(evolution.symbolic_evolution_for_file(EXAMPLE_PATH), EXAMPLE_PATH.name)

        self.assertIn(r"\section*{Quantikz Examples With Symbolic Evolution}", latex)
        self.assertIn(r"\subsection*{1. Baseline single-qubit path}", latex)
        self.assertIn(r"\ket{\psi_1} = \frac{1}{\sqrt{2}} \ket{0} + \frac{1}{\sqrt{2}} \ket{1}", latex)
        self.assertIn(r"\mathcal{O}_{2}\ket{\psi_{1}}", latex)
        self.assertIn(r"\end{document}", latex)


if __name__ == "__main__":
    unittest.main()
