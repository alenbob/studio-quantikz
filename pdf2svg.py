#!/usr/bin/env python3
"""
Convert a PDF into SVG files, one SVG per page.

Requirements:
  - Python 3.8+
  - Poppler installed, with `pdftocairo` available in PATH

Examples:
  python pdf_to_svg.py input.pdf
  python pdf_to_svg.py input.pdf -o output_dir
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path


def check_dependency() -> None:
    """Ensure pdftocairo is installed and available."""
    if shutil.which("pdftocairo") is None:
        print(
            "Error: `pdftocairo` was not found in your PATH.\n"
            "Install Poppler first:\n"
            "  - Ubuntu/Debian: sudo apt install poppler-utils\n"
            "  - macOS (Homebrew): brew install poppler\n"
            "  - Windows: install Poppler and add its bin folder to PATH",
            file=sys.stderr,
        )
        sys.exit(1)


def convert_pdf_to_svg(pdf_path: Path, output_dir: Path) -> None:
    """Convert all pages of a PDF to SVG files."""
    if not pdf_path.exists():
        raise FileNotFoundError(f"Input PDF not found: {pdf_path}")

    if pdf_path.suffix.lower() != ".pdf":
        raise ValueError(f"Input file is not a PDF: {pdf_path}")

    output_dir.mkdir(parents=True, exist_ok=True)

    output_prefix = output_dir / pdf_path.stem

    cmd = [
        "pdftocairo",
        "-svg",
        str(pdf_path),
        str(output_prefix),
    ]

    try:
        subprocess.run(cmd, check=True)
    except subprocess.CalledProcessError as exc:
        raise RuntimeError(f"Conversion failed with exit code {exc.returncode}") from exc

    print(f"Done. SVG files written to: {output_dir}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Convert a PDF into SVG files (one SVG per page)."
    )
    parser.add_argument(
        "input_pdf",
        type=Path,
        help="Path to the input PDF file",
    )
    parser.add_argument(
        "-o",
        "--output-dir",
        type=Path,
        default=Path("svg_output"),
        help="Directory to write SVG files into (default: svg_output)",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    check_dependency()

    try:
        convert_pdf_to_svg(args.input_pdf.resolve(), args.output_dir.resolve())
    except Exception as exc:
        print(f"Error: {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()