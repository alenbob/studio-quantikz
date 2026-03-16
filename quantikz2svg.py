#!/usr/bin/env python3
"""Experimental Quantikz-to-SVG renderer through node-tikzjax with injected support files."""

from __future__ import annotations

import argparse
import pathlib
import re
import sys

from tikz2svg import (
    DEFAULT_TIKZ_PREAMBLE,
    WASM_RENDER_SOURCE,
    ensure_document_body,
    run_node_tikzjax_script,
    sanitize_preamble_for_wasm,
    validate_svg_markup,
)


DEFAULT_QUANTIKZ_PREAMBLE = "\n".join([
    DEFAULT_TIKZ_PREAMBLE,
    r"\usetikzlibrary{quantikz2}",
])
QUANTIKZ_SUPPORT_DIR = pathlib.Path(__file__).resolve().parent / "src" / "server" / "tex-files"
EXPERIMENTAL_RENDER_SOURCE = "node-tikzjax wasm experimental quantikz"
NODE_TIKZJAX_QUANTIKZ_RENDER_SCRIPT = r"""
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const chunks = [];
for await (const chunk of process.stdin) {
    chunks.push(chunk);
}

const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
const tikzjaxModule = await import('node-tikzjax');
const api = {
    load: tikzjaxModule.load ?? tikzjaxModule.default?.load,
    dumpMemfs: tikzjaxModule.dumpMemfs ?? tikzjaxModule.default?.dumpMemfs,
    tex: tikzjaxModule.tex ?? tikzjaxModule.default?.tex,
    dvi2svg: tikzjaxModule.dvi2svg ?? tikzjaxModule.default?.dvi2svg,
};

if (!api.load || !api.dumpMemfs || !api.tex || !api.dvi2svg) {
    throw new Error('node-tikzjax low-level API is not available.');
}

await api.load();
const memfs = api.dumpMemfs();

function syncSupportFiles(sourceDir, targetDir) {
    for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
        const sourcePath = path.join(sourceDir, entry.name);
        const targetPath = `${targetDir}/${entry.name}`;
        if (entry.isDirectory()) {
            try {
                memfs.mkdirSync(targetPath);
            } catch {}
            syncSupportFiles(sourcePath, targetPath);
            continue;
        }
        if (entry.isFile()) {
            memfs.writeFileSync(targetPath, fs.readFileSync(sourcePath));
        }
    }
}

syncSupportFiles(payload.supportDir, '/tex_files');

const dvi = await api.tex(payload.source, {
    addToPreamble: payload.addToPreamble,
    showConsole: Boolean(payload.showConsole),
});
const svg = await api.dvi2svg(dvi, {
    embedFontCss: false,
    disableOptimize: false,
});

process.stdout.write(JSON.stringify({ svg }));
""".strip()


class QuantikzEnvironment:
    def __init__(self, index: int, options: str, body: str):
        self.index = index
        self.options = options
        self.body = body

    @property
    def source(self) -> str:
        return f"\\begin{{quantikz}}{self.options}{self.body}\\end{{quantikz}}"


def find_quantikz_environments(source_text: str) -> list[QuantikzEnvironment]:
    environments = [
        QuantikzEnvironment(index=index, options=(match.group(1) or ""), body=match.group(2))
        for index, match in enumerate(re.finditer(r"\\begin\{quantikz\}(\[[^\]]*\])?(.*?)\\end\{quantikz\}", source_text, re.S))
    ]
    return environments


def list_environments(source_text: str) -> int:
    environments = find_quantikz_environments(source_text)
    if not environments:
        print("No quantikz environment found", file=sys.stderr)
        return 1
    for environment in environments:
        preview = " ".join(environment.body.strip().split())[:100]
        print(f"{environment.index}: {preview}")
    return 0


def select_quantikz_source(source_text: str, env_index: int, full_document: bool) -> str:
    if full_document:
        return source_text

    environments = find_quantikz_environments(source_text)
    if not environments:
        return source_text
    if env_index < 0 or env_index >= len(environments):
        raise SystemExit(
            f"Quantikz environment index {env_index} is out of range; found {len(environments)} environment(s)"
        )
    return environments[env_index].source


def build_quantikz_document(quantikz_source: str, extra_preamble: str) -> str:
    quantikz_source = quantikz_source.strip()
    if r"\begin{document}" in quantikz_source:
        return quantikz_source

    preamble = sanitize_preamble_for_wasm(
        extra_preamble,
        base_preamble=DEFAULT_QUANTIKZ_PREAMBLE,
    )
    return "\n".join([
        preamble,
        ensure_document_body(quantikz_source),
    ])


def render_quantikz_to_svg_with_wasm(
    quantikz_source: str,
    extra_preamble: str = "",
    *,
    show_console: bool = False,
) -> str:
    if not QUANTIKZ_SUPPORT_DIR.exists():
        raise RuntimeError(f"Quantikz support directory not found: {QUANTIKZ_SUPPORT_DIR}")

    payload = {
        "source": build_quantikz_document(quantikz_source, extra_preamble),
        "addToPreamble": "",
        "supportDir": str(QUANTIKZ_SUPPORT_DIR),
        "showConsole": show_console,
    }
    response = run_node_tikzjax_script(
        NODE_TIKZJAX_QUANTIKZ_RENDER_SCRIPT,
        payload,
        error_prefix="Experimental Quantikz WASM renderer failed.",
        error_limit=4000 if show_console else 1600,
    )
    svg_markup = response.get("svg")
    if not isinstance(svg_markup, str):
        raise RuntimeError("Experimental Quantikz renderer did not return SVG markup.")
    return svg_markup


def render_quantikz_to_svg(
    quantikz_source: str,
    output_path: str | pathlib.Path,
    extra_preamble: str = "",
    *,
    show_console: bool = False,
) -> str:
    svg_markup = validate_svg_markup(
        _render_quantikz_to_svg_with_diagnostics(
            quantikz_source,
            extra_preamble,
            show_console=show_console,
        ),
        EXPERIMENTAL_RENDER_SOURCE,
    )
    output_path = pathlib.Path(output_path)
    output_path.write_text(svg_markup, encoding="utf-8")
    return EXPERIMENTAL_RENDER_SOURCE


def _render_quantikz_to_svg_with_diagnostics(
    quantikz_source: str,
    extra_preamble: str,
    *,
    show_console: bool,
) -> str:
    try:
        return render_quantikz_to_svg_with_wasm(
            quantikz_source,
            extra_preamble,
            show_console=show_console,
        )
    except RuntimeError as exc:
        message = str(exc)
        if "Required primitives not found" in message:
            raise RuntimeError(
                "Experimental Quantikz WASM renderer failed. "
                "The Quantikz support files were loaded, but node-tikzjax's bundled TeX engine "
                "is missing the expl3 primitives required by Quantikz."
            ) from exc
        raise


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Experimental Quantikz-to-SVG renderer using node-tikzjax and injected support files."
    )
    parser.add_argument("input", help="Path to a TeX file containing Quantikz code")
    parser.add_argument("output", nargs="?", help="Path to write the resulting SVG")
    parser.add_argument("--env-index", type=int, default=0, help="Zero-based quantikz environment index")
    parser.add_argument("--full-document", action="store_true", help="Render the entire input document as-is")
    parser.add_argument("--list-envs", action="store_true", help="List detected quantikz environments and exit")
    parser.add_argument(
        "--extra-preamble",
        default="",
        help=r'Extra LaTeX preamble lines, e.g. "\usepackage{pgfplots}\n\pgfplotsset{compat=newest}"',
    )
    parser.add_argument(
        "--show-console",
        action="store_true",
        help="Show TeX engine console output from node-tikzjax for debugging",
    )

    args = parser.parse_args()

    input_path = pathlib.Path(args.input)
    if not input_path.exists():
        print(f"Input file not found: {input_path}", file=sys.stderr)
        return 2

    source_text = input_path.read_text(encoding="utf-8")

    if args.list_envs:
        return list_environments(source_text)

    if not args.output:
        print("Output path is required unless --list-envs is used", file=sys.stderr)
        return 2

    try:
        quantikz_source = select_quantikz_source(source_text, args.env_index, args.full_document)
        render_source = render_quantikz_to_svg(
            quantikz_source,
            args.output,
            args.extra_preamble,
            show_console=args.show_console,
        )
    except SystemExit as exc:
        print(str(exc), file=sys.stderr)
        return 1
    except Exception as exc:
        print(f"Render failed: {exc}", file=sys.stderr)
        return 1

    print(f"Saved SVG to: {args.output}")
    print(f"Render source: {render_source}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())