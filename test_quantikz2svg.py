import unittest

import quantikz2svg


MULTI_ENV_SOURCE = r"""
\section*{Demo}
\[
\begin{quantikz}
\lstick{\ket{0}} & \gate{H}
\end{quantikz}
\]

\[
\begin{quantikz}[row sep=0.7cm]
\lstick{\ket{1}} & \gate{X}
\end{quantikz}
\]
"""


class Quantikz2SvgTests(unittest.TestCase):
    def test_lists_quantikz_environments(self) -> None:
        environments = quantikz2svg.find_quantikz_environments(MULTI_ENV_SOURCE)
        self.assertEqual(len(environments), 2)
        self.assertEqual(environments[1].options, "[row sep=0.7cm]")

    def test_selects_single_environment_by_default(self) -> None:
        selected = quantikz2svg.select_quantikz_source(MULTI_ENV_SOURCE, env_index=1, full_document=False)
        self.assertIn(r"\begin{quantikz}[row sep=0.7cm]", selected)
        self.assertNotIn(r"\section*{Demo}", selected)

    def test_wraps_quantikz_environment_in_document(self) -> None:
        document = quantikz2svg.build_quantikz_document(r"\begin{quantikz}\gate{H}\end{quantikz}", "")
        self.assertIn(r"\usetikzlibrary{quantikz2}", document)
        self.assertIn(r"\begin{document}", document)
        self.assertIn(r"\end{document}", document)


if __name__ == "__main__":
    unittest.main()