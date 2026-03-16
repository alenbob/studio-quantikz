#!/usr/bin/env python3
"""
quicklatex_tikz_svg.py

Send TikZ/LaTeX to QuickLaTeX and download the resulting SVG.

Usage:
    python quicklatex_tikz_svg.py input.tex output.svg
    python quicklatex_tikz_svg.py input.tex output.svg --font-size 18px --font-color 000000
"""

from __future__ import annotations

import argparse
import pathlib
import re
import sys
import urllib.error
import urllib.parse
import urllib.request


QUICKLATEX_ENDPOINT = "https://www.quicklatex.com/latex3.f"


def build_formula(
    tikz_code: str,
    extra_preamble: str = "",
    add_tikz_package: bool = True,
) -> str:
    """
    Wrap raw TikZ code into a QuickLaTeX-friendly formula string.

    If the input already contains \\begin{tikzpicture}, it is kept as-is.
    Otherwise, the code is wrapped in a tikzpicture environment.
    """
    tikz_code = tikz_code.strip()

    if r"\begin{tikzpicture}" not in tikz_code:
        tikz_code = "\\begin{tikzpicture}\n" + tikz_code + "\n\\end{tikzpicture}"

    preamble_lines = []
    if add_tikz_package:
        preamble_lines.append(r"\usepackage{tikz}")
    if extra_preamble.strip():
        preamble_lines.append(extra_preamble.strip())

    if preamble_lines:
        preamble_block = "[+preamble]\n" + "\n".join(preamble_lines) + "\n[/preamble]\n"
        return tikz_code.replace(r"\begin{tikzpicture}", preamble_block + r"\begin{tikzpicture}", 1)

    return tikz_code


def post_to_quicklatex(
    formula: str,
    font_size: str = "17px",
    font_color: str = "000000",
    mode: str = "0",
    timeout: int = 60,
) -> str:
    """
    POST formula to QuickLaTeX and return the raw response body.

    The public integration example uses:
      formula, fsize, fcolor, mode, out, remhost
    """
    payload = {
        "formula": formula,
        "fsize": font_size,
        "fcolor": font_color,
        "mode": mode,
        "out": "1",
        "remhost": "quicklatex.com",
    }

    data = urllib.parse.urlencode(payload).encode("utf-8")
    req = urllib.request.Request(
        QUICKLATEX_ENDPOINT,
        data=data,
        headers={
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "User-Agent": "quicklatex-tikz-svg/1.0",
        },
        method="POST",
    )

    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", errors="replace").strip()


def extract_png_url(response_text: str) -> str:
    """
    Extract the first PNG URL from QuickLaTeX's response.

    The exact response format is not formally documented here, so this
    parser searches for a URL anywhere in the response body.
    """
    match = re.search(r"https?://\S+?\.png\b", response_text)
    if not match:
        raise RuntimeError(
            "QuickLaTeX response did not contain a PNG URL.\n"
            f"Raw response:\n{response_text}"
        )
    return match.group(0)


def png_url_to_svg_url(png_url: str) -> str:
    """Convert the returned PNG URL to the corresponding SVG URL."""
    if not png_url.lower().endswith(".png"):
        raise ValueError(f"Expected a PNG URL, got: {png_url}")
    return png_url[:-4] + ".svg"


def download_bytes(url: str, timeout: int = 60) -> bytes:
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "quicklatex-tikz-svg/1.0"},
        method="GET",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def render_tikz_to_svg(
    tikz_source: str,
    output_path: str | pathlib.Path,
    font_size: str = "17px",
    font_color: str = "000000",
    extra_preamble: str = "",
) -> str:
    """
    Render TikZ source to SVG and save it to output_path.

    Returns the SVG URL used for download.
    """
    formula = build_formula(
        tikz_code=tikz_source,
        extra_preamble=extra_preamble,
        add_tikz_package=True,
    )

    raw_response = post_to_quicklatex(
        formula=formula,
        font_size=font_size,
        font_color=font_color,
        mode="0",
    )

    png_url = extract_png_url(raw_response)
    svg_url = png_url_to_svg_url(png_url)
    svg_bytes = download_bytes(svg_url)

    output_path = pathlib.Path(output_path)
    output_path.write_bytes(svg_bytes)

    return svg_url


def main() -> int:
    parser = argparse.ArgumentParser(description="Render TikZ to SVG via QuickLaTeX.")
    parser.add_argument("input", help="Path to a .tex/.tikz file containing TikZ code")
    parser.add_argument("output", help="Path to write the resulting SVG")
    parser.add_argument(
        "--font-size",
        default="17px",
        help='QuickLaTeX fsize value, e.g. "17px"',
    )
    parser.add_argument(
        "--font-color",
        default="000000",
        help='QuickLaTeX fcolor value as 6-digit hex without "#", e.g. "000000"',
    )
    parser.add_argument(
        "--extra-preamble",
        default="",
        help=r'Extra LaTeX preamble lines, e.g. "\usepackage{pgfplots}\n\pgfplotsset{compat=newest}"',
    )

    args = parser.parse_args()

    input_path = pathlib.Path(args.input)
    if not input_path.exists():
        print(f"Input file not found: {input_path}", file=sys.stderr)
        return 2

    tikz_source = input_path.read_text(encoding="utf-8")

    try:
        svg_url = render_tikz_to_svg(
            tikz_source=tikz_source,
            output_path=args.output,
            font_size=args.font_size,
            font_color=args.font_color,
            extra_preamble=args.extra_preamble,
        )
    except urllib.error.HTTPError as e:
        print(f"HTTP error from QuickLaTeX: {e.code} {e.reason}", file=sys.stderr)
        return 1
    except urllib.error.URLError as e:
        print(f"Network error contacting QuickLaTeX: {e}", file=sys.stderr)
        return 1
    except Exception as e:
        print(f"Render failed: {e}", file=sys.stderr)
        return 1

    print(f"Saved SVG to: {args.output}")
    print(f"SVG URL: {svg_url}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())