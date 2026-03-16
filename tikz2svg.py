#!/usr/bin/env python3
"""Render plain TikZ source to SVG through node-tikzjax."""

from __future__ import annotations

import argparse
import base64
import json
import pathlib
import re
import subprocess
import sys
import xml.etree.ElementTree as ET


DEFAULT_TIKZ_PREAMBLE = "\n".join([
    r"\usepackage{tikz}",
    r"\providecommand{\ket}[1]{\left|#1\right\rangle}",
    r"\providecommand{\bra}[1]{\left\langle#1\right|}",
    r"\providecommand{\proj}[1]{\left|#1\right\rangle\left\langle#1\right|}",
])
WASM_RENDER_SOURCE = "node-tikzjax wasm"
NODE_TIKZJAX_CSS_PATH = pathlib.Path(__file__).resolve().parent / "node_modules" / "node-tikzjax" / "css"
NODE_TIKZJAX_RENDER_SCRIPT = r"""
import process from 'node:process';

const chunks = [];
for await (const chunk of process.stdin) {
    chunks.push(chunk);
}

const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
const tikzjaxModule = await import('node-tikzjax');
const tex2svg = typeof tikzjaxModule.default?.default === 'function'
    ? tikzjaxModule.default.default
    : typeof tikzjaxModule.default === 'function'
        ? tikzjaxModule.default
        : typeof tikzjaxModule === 'function'
            ? tikzjaxModule
            : null;

if (!tex2svg) {
    throw new Error('node-tikzjax is not available.');
}

const svg = await tex2svg(payload.source, {
    addToPreamble: payload.addToPreamble,
    embedFontCss: false,
    disableOptimize: false,
});

process.stdout.write(JSON.stringify({ svg }));
""".strip()

ET.register_namespace("", "http://www.w3.org/2000/svg")


def summarize_response(response_text: str, limit: int = 280) -> str:
    compact = " ".join(response_text.split())
    if len(compact) <= limit:
        return compact
    return compact[:limit] + "..."


def strip_leading_comments(tikz_code: str) -> str:
    lines = tikz_code.splitlines()
    index = 0
    while index < len(lines):
        stripped = lines[index].strip()
        if not stripped or stripped.startswith("%"):
            index += 1
            continue
        break
    return "\n".join(lines[index:]).strip()


def ensure_document_body(tikz_code: str) -> str:
    tikz_code = strip_leading_comments(tikz_code)
    if not tikz_code:
        return ""
    if r"\begin{document}" in tikz_code:
        return tikz_code
    return "\n".join([
        r"\begin{document}",
        tikz_code,
        r"\end{document}",
    ])


def sanitize_usepackage_line(line: str, stripped_packages: set[str] | None = None) -> str | None:
    match = re.match(r"^\s*\\usepackage(?:\[(?P<options>[^\]]*)\])?\{(?P<packages>[^}]*)\}\s*$", line)
    if not match:
        return line

    stripped_packages = stripped_packages or set()
    packages = [
        entry.strip()
        for entry in match.group("packages").split(",")
        if entry.strip() and entry.strip() not in stripped_packages
    ]
    if not packages:
        return None

    options = match.group("options")
    option_block = f"[{options}]" if options else ""
    return f"\\usepackage{option_block}{{{','.join(packages)}}}"


def sanitize_tikz_library_line(line: str, stripped_libraries: set[str] | None = None) -> str | None:
    match = re.match(r"^\s*\\usetikzlibrary\{(?P<libraries>[^}]*)\}\s*$", line)
    if not match:
        return line

    stripped_libraries = stripped_libraries or set()
    libraries = [
        entry.strip()
        for entry in match.group("libraries").split(",")
        if entry.strip() and entry.strip() not in stripped_libraries
    ]
    if not libraries:
        return None

    return f"\\usetikzlibrary{{{','.join(libraries)}}}"


def sanitize_preamble_for_wasm(
    extra_preamble: str,
    *,
    base_preamble: str = DEFAULT_TIKZ_PREAMBLE,
    stripped_packages: set[str] | None = None,
    stripped_libraries: set[str] | None = None,
) -> str:
    sanitized_lines = []
    seen_lines: set[str] = set()

    for line in [*base_preamble.splitlines(), *extra_preamble.splitlines()]:
        stripped = line.strip()
        if not stripped or stripped == r"\begin{document}" or stripped == r"\end{document}":
            continue
        if re.match(r"^\\documentclass\b", stripped):
            continue

        sanitized_line = sanitize_usepackage_line(stripped, stripped_packages)
        if sanitized_line is None:
            continue
        sanitized_line = sanitize_tikz_library_line(sanitized_line, stripped_libraries)
        if sanitized_line is None or sanitized_line in seen_lines:
            continue

        seen_lines.add(sanitized_line)
        sanitized_lines.append(sanitized_line)

    return "\n".join(sanitized_lines)


def run_node_tikzjax_script(
    script: str,
    payload: dict[str, object],
    *,
    error_prefix: str,
    error_limit: int = 280,
) -> dict[str, object]:
    workspace_root = pathlib.Path(__file__).resolve().parent
    completed = subprocess.run(
        ["node", "--input-type=module", "-e", script],
        cwd=workspace_root,
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        check=False,
    )
    if completed.returncode != 0:
        output = "\n".join(part for part in (completed.stdout, completed.stderr) if part).strip()
        if error_limit > 0:
            summary = summarize_response(output or "node-tikzjax exited with a non-zero status.", limit=error_limit)
        else:
            summary = output or "node-tikzjax exited with a non-zero status."
        raise RuntimeError(f"{error_prefix}\n{summary}")

    try:
        response = json.loads(completed.stdout)
    except json.JSONDecodeError as exc:
        preview = summarize_response(completed.stdout or completed.stderr)
        raise RuntimeError(f"{error_prefix}\nRenderer returned invalid JSON.\n{preview}") from exc

    if not isinstance(response, dict):
        raise RuntimeError(f"{error_prefix}\nRenderer did not return a JSON object.")
    return response


def parse_node_tikzjax_font_faces() -> dict[str, pathlib.Path]:
    css_path = NODE_TIKZJAX_CSS_PATH / "fonts.css"
    if not css_path.exists():
        return {}

    css_markup = css_path.read_text(encoding="utf-8")
    font_faces: dict[str, pathlib.Path] = {}
    for match in re.finditer(
        r"@font-face\s*\{\s*font-family:\s*([^;]+);\s*src:\s*url\('([^']+)'\);\s*\}",
        css_markup,
    ):
        family = match.group(1).strip().strip('"\'')
        relative_path = match.group(2).strip()
        font_faces[family] = (NODE_TIKZJAX_CSS_PATH / relative_path).resolve()
    return font_faces


def collect_svg_font_families(root: ET.Element) -> set[str]:
    used_families: set[str] = set()
    for element in root.iter():
        font_family = (element.get("font-family") or "").strip()
        if not font_family:
            continue
        for family in font_family.split(","):
            normalized = family.strip().strip('"\'')
            if normalized:
                used_families.add(normalized)
    return used_families


def build_embedded_font_css(used_families: set[str]) -> str:
    font_faces = parse_node_tikzjax_font_faces()
    css_rules = []
    for family in sorted(used_families):
        font_path = font_faces.get(family)
        if font_path is None or not font_path.exists():
            continue
        font_bytes = font_path.read_bytes()
        encoded_font = base64.b64encode(font_bytes).decode("ascii")
        css_rules.append(
            "@font-face { "
            f"font-family: {family}; "
            f"src: url('data:font/ttf;base64,{encoded_font}') format('truetype'); "
            "}"
        )
    return "\n".join(css_rules)


def embed_math_fonts(svg_markup: str) -> str:
    try:
        root = ET.fromstring(svg_markup)
    except ET.ParseError:
        return svg_markup

    embedded_font_css = build_embedded_font_css(collect_svg_font_families(root))
    if not embedded_font_css:
        return svg_markup

    svg_ns = "{http://www.w3.org/2000/svg}"
    defs = root.find(f"{svg_ns}defs")
    if defs is None:
        defs = ET.Element(f"{svg_ns}defs")
        root.insert(0, defs)

    for child in list(defs):
        if child.tag == f"{svg_ns}style" and child.get("id") == "tikz2svg-embedded-fonts":
            defs.remove(child)

    style = ET.Element(f"{svg_ns}style", {"id": "tikz2svg-embedded-fonts"})
    style.text = embedded_font_css
    defs.insert(0, style)
    return ET.tostring(root, encoding="unicode")


def render_tikz_to_svg_with_wasm(tikz_source: str, extra_preamble: str = "") -> str:
    payload = {
        "source": ensure_document_body(tikz_source),
        "addToPreamble": sanitize_preamble_for_wasm(extra_preamble),
    }
    response = run_node_tikzjax_script(
        NODE_TIKZJAX_RENDER_SCRIPT,
        payload,
        error_prefix="WASM TikZ renderer failed.",
    )
    svg_markup = response.get("svg")
    if not isinstance(svg_markup, str):
        raise RuntimeError("WASM TikZ renderer did not return SVG markup.")
    return svg_markup


def has_graphic_primitives(svg_markup: str) -> bool:
    body = svg_markup.split("</defs>", 1)[1] if "</defs>" in svg_markup else svg_markup
    return any(
        token in body
        for token in ("<path", "<line", "<rect", "<circle", "<ellipse", "<polygon", "<polyline", "<text")
    )


def validate_svg_markup(svg_markup: str, source_name: str) -> str:
    if "<svg" not in svg_markup:
        preview = summarize_response(svg_markup)
        raise RuntimeError(
            "Renderer output was not SVG markup.\n"
            f"Render source: {source_name}\n"
            f"Payload summary:\n{preview}"
        )
    if not has_graphic_primitives(svg_markup):
        raise RuntimeError(
            "Renderer returned SVG markup without any drawing primitives outside <defs>.\n"
            f"Render source: {source_name}"
        )
    return svg_markup


def render_tikz_to_svg(
    tikz_source: str,
    output_path: str | pathlib.Path,
    extra_preamble: str = "",
) -> str:
    svg_markup = embed_math_fonts(
        validate_svg_markup(
            render_tikz_to_svg_with_wasm(
                tikz_source=tikz_source,
                extra_preamble=extra_preamble,
            ),
            WASM_RENDER_SOURCE,
        )
    )
    output_path = pathlib.Path(output_path)
    output_path.write_text(svg_markup, encoding="utf-8")
    return WASM_RENDER_SOURCE


def main() -> int:
    parser = argparse.ArgumentParser(description="Render plain TikZ to SVG with node-tikzjax.")
    parser.add_argument("input", help="Path to a .tex/.tikz file containing plain TikZ code")
    parser.add_argument("output", help="Path to write the resulting SVG")
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
        render_source = render_tikz_to_svg(
            tikz_source=tikz_source,
            output_path=args.output,
            extra_preamble=args.extra_preamble,
        )
    except Exception as exc:
        print(f"Render failed: {exc}", file=sys.stderr)
        return 1

    print(f"Saved SVG to: {args.output}")
    print(f"Render source: {render_source}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())