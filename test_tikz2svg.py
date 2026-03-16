import pathlib
import tempfile
import unittest
from unittest import mock

import tikz2svg


VALID_SVG = "<svg><defs></defs><path d='M0 0 L1 1'/></svg>"
PLAIN_TIKZ = "\\begin{tikzpicture}\\draw (0,0) -- (1,0);\\end{tikzpicture}"


class Tikz2SvgTests(unittest.TestCase):
    def test_embeds_only_used_math_fonts(self) -> None:
        svg = (
            '<svg xmlns="http://www.w3.org/2000/svg">'
            '<text font-family="cmmi10">q</text>'
            '<text font-family="cmr7">0</text>'
            '</svg>'
        )

        normalized = tikz2svg.embed_math_fonts(svg)
        font_style = normalized.split('<style id="tikz2svg-embedded-fonts">', 1)[1].split("</style>", 1)[0]

        self.assertIn("font-family: cmmi10;", normalized)
        self.assertIn("font-family: cmr7;", normalized)
        self.assertIn("data:font/ttf;base64,", normalized)
        self.assertNotIn("font-family: cmsy10;", normalized)
        self.assertNotIn("@import", font_style)
        self.assertNotIn("https://", font_style)
        self.assertNotIn("http://", font_style)
        self.assertNotIn("file://", font_style)

    def test_writes_svg_to_requested_output(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            output_path = pathlib.Path(temp_dir) / "out.svg"
            with mock.patch.object(tikz2svg, "render_tikz_to_svg_with_wasm", return_value=VALID_SVG):
                render_source = tikz2svg.render_tikz_to_svg(PLAIN_TIKZ, output_path)

            self.assertEqual(output_path.read_text(encoding="utf-8"), VALID_SVG)
            self.assertEqual(render_source, tikz2svg.WASM_RENDER_SOURCE)

    def test_invalid_svg_payload_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            output_path = pathlib.Path(temp_dir) / "out.svg"
            with mock.patch.object(tikz2svg, "render_tikz_to_svg_with_wasm", return_value="not svg"):
                with self.assertRaisesRegex(RuntimeError, "not SVG markup"):
                    tikz2svg.render_tikz_to_svg(PLAIN_TIKZ, output_path)

    def test_text_only_svg_is_accepted(self) -> None:
        svg = '<svg xmlns="http://www.w3.org/2000/svg"><text font-family="cmr10">x</text></svg>'

        validated = tikz2svg.validate_svg_markup(svg, tikz2svg.WASM_RENDER_SOURCE)

        self.assertEqual(validated, svg)


if __name__ == "__main__":
    unittest.main()