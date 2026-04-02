import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import pako from "pako";
import App from "../src/renderer/App";
import { BUG_REPORT_RESTORE_SEARCH_PARAM, buildBugReportRestoreStorageKey } from "../src/renderer/bugReportRestore";
import { BUG_REPORT_DESCRIPTION_MAX_LENGTH } from "../src/shared/bugReport";
import { DEFAULT_CIRCUIT_LAYOUT, getCellCenterX, getGridHeight, getGridWidth, getIncomingSegmentRange, getRowY, getWireStartX } from "../src/renderer/layout";
import { initialState } from "../src/renderer/reducer";
import { SHARE_CODE_ID_SEARCH_PARAM, SHARE_CODE_SEARCH_PARAM } from "../src/renderer/shareUrl";
import * as renderedPdfModule from "../src/renderer/useRenderedPdf";
import * as symbolicLatexModule from "../src/renderer/useSymbolicLatex";

const BASE62_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function encodeToBase62(data: Uint8Array): string {
  let num = 0n;
  for (let i = 0; i < data.length; i++) {
    num = (num << 8n) | BigInt(data[i]);
  }

  if (num === 0n) return "0";

  let result = "";
  while (num > 0n) {
    result = BASE62_ALPHABET[Number(num % 62n)] + result;
    num = num / 62n;
  }

  return result;
}

function compressPayload(code: string, preamble: string): string {
  const payload = preamble ? [code, preamble] : [code];
  const jsonStr = JSON.stringify(payload);
  const compressed = pako.deflate(jsonStr);
  return encodeToBase62(compressed);
}

vi.mock("../src/renderer/pdfRaster", () => ({
  renderPdfBlobToPngBlob: vi.fn(async () => new Blob(["png-preview"], { type: "image/png" }))
}));

beforeEach(() => {
  window.history.replaceState({}, "", "/");
});

afterEach(() => {
  window.history.replaceState({}, "", "/");
});

function mockBoardRect(board: HTMLDivElement, steps = 5, qubits = 3): void {
  const width = getGridWidth(steps, DEFAULT_CIRCUIT_LAYOUT);
  const height = getGridHeight(qubits, DEFAULT_CIRCUIT_LAYOUT);

  vi.spyOn(board, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: width,
    bottom: height,
    width,
    height,
    toJSON: () => ({})
  } as DOMRect);
}

describe("App smoke tests", () => {
  it("shows local SVG status in figure preview header", () => {
    render(<App />);

    expect(screen.getByText(/SVG not enabled \(using PDF preview\)\./i)).toBeInTheDocument();
  });

  it("places a gate onto the snapped grid and exports it", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(screen.getByRole("button", { name: /^gate$/i }));
    await user.click(screen.getByTestId("grid-cell-0-0"));
    await user.click(screen.getByRole("button", { name: /convert to quantikz/i }));

    const gateRect = container.querySelector('rect[data-kind="gate-rect"]') as SVGRectElement;
    expect(gateRect.getAttribute("rx")).toBe("0");
    expect((screen.getByLabelText(/quantikz output/i) as HTMLTextAreaElement).value).toContain("\\gate{U}");
  });

  it("selects a column header and converts it to an equals separator", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByTestId("grid-column-header-2"));

    expect(screen.getByText(/column controls/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add left/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add right/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /convert to equal/i }));
    await user.click(screen.getByRole("button", { name: /unlock wires/i }));
    await user.click(screen.getByTestId("segment-slot-0-2"));
    expect(screen.getByLabelText(/classical wire/i)).toBeInTheDocument();
    await user.click(screen.getByTestId("segment-slot-0-3"));
    expect(screen.getByLabelText(/bundle wire/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /convert to quantikz/i }));

    expect((screen.getByLabelText(/quantikz output/i) as HTMLTextAreaElement).value).toContain("\\midstick[wires=3]{=}");
  });

  it("selects a row header and adds or deletes rows from the inspector", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByTestId("grid-row-header-0"));

    expect(screen.getByText(/row controls/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add above/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add below/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /convert to equal/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /add below/i }));
    await waitFor(() => expect(screen.getByLabelText(/^qubits$/i)).toHaveValue("4"));
    expect(screen.getByTestId("grid-row-header-3")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /delete row/i }));
    await waitFor(() => expect(screen.getByLabelText(/^qubits$/i)).toHaveValue("3"));
  });

  it("resets the editor and exports wire labels", async () => {
    const user = userEvent.setup();
    render(<App />);

    window.history.replaceState({}, "", "/?q=stale-circuit&qp=stale-preamble#fragment");

    await user.click(screen.getByLabelText(/edit left wire label q1/i));
    fireEvent.change(screen.getByLabelText(/inline left wire label q1/i), {
      target: { value: "\\ket{0}" }
    });
    fireEvent.blur(screen.getByLabelText(/inline left wire label q1/i));
    await user.click(screen.getByRole("button", { name: /convert to quantikz/i }));

    expect((screen.getByLabelText(/quantikz output/i) as HTMLTextAreaElement).value).toContain("\\lstick{$\\ket{0}$}");

    await user.click(screen.getByRole("button", { name: /^reset$/i }));

    expect((screen.getByLabelText(/quantikz output/i) as HTMLTextAreaElement).value).toBe("");
    expect(screen.getByLabelText(/edit left wire label q1/i)).toBeInTheDocument();
    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("");
  });

  it("exports spacing set from the visual sliders", async () => {
    const user = userEvent.setup();
    render(<App />);

    fireEvent.change(screen.getByLabelText(/row spacing/i), { target: { value: "1.15" } });
    fireEvent.change(screen.getByLabelText(/column spacing/i), { target: { value: "0.95" } });

    await user.click(screen.getByRole("button", { name: /convert to quantikz/i }));

    expect((screen.getByLabelText(/quantikz output/i) as HTMLTextAreaElement).value).toContain(
      "\\begin{quantikz}[row sep={1.15cm,between origins}, column sep=0.95cm]"
    );
  });

  it("edits wire labels directly on the circuit", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByLabelText(/edit left wire label q1/i));
    const inlineInput = screen.getByLabelText(/inline left wire label q1/i);
    fireEvent.change(inlineInput, { target: { value: "\\ket{c}_C" } });
    fireEvent.blur(inlineInput);

    await user.click(screen.getByRole("button", { name: /convert to quantikz/i }));

    expect((screen.getByLabelText(/quantikz output/i) as HTMLTextAreaElement).value).toContain("\\lstick{$\\ket{c}_C$}");
  });

  it("replaces the left palette with object controls while an item is selected", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(screen.getByRole("button", { name: /^gate$/i }));
    await user.click(screen.getByTestId("grid-cell-0-0"));
    await user.click(screen.getByRole("button", { name: /^select$/i }));

    const gateRect = container.querySelector('rect[data-kind="gate-rect"]') as SVGRectElement;
    fireEvent.pointerDown(gateRect, { button: 0 });

    expect(screen.getByText(/object controls/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/gate label/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^gate$/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /back to tools/i }));

    expect(screen.getByRole("button", { name: /^gate$/i })).toBeInTheDocument();
  });

  it("renders the orange selected-object overlay for a single selected gate", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(screen.getByRole("button", { name: /^gate$/i }));
    await user.click(screen.getByTestId("grid-cell-0-0"));
    await user.click(screen.getByRole("button", { name: /^select$/i }));

    const gateRect = container.querySelector('rect[data-kind="gate-rect"]') as SVGRectElement;
    fireEvent.pointerDown(gateRect, { button: 0 });

    expect(container.querySelectorAll(".item-outline-selected")).toHaveLength(1);
    expect(container.querySelectorAll(".selected-gate-overlay")).toHaveLength(1);
  });

  it("merges the contour around multiple selected objects and draws orange overlays on top", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(screen.getByRole("button", { name: /^gate$/i }));
    await user.click(screen.getByTestId("grid-cell-0-0"));
    await user.click(screen.getByTestId("grid-cell-0-1"));
    await user.click(screen.getByRole("button", { name: /^select$/i }));

    fireEvent.keyDown(window, { key: "a", ctrlKey: true });

    expect(container.querySelectorAll(".merged-selection-outline")).toHaveLength(1);
    expect(container.querySelectorAll(".item-outline-selected")).toHaveLength(0);
    expect(container.querySelectorAll(".selected-gate-overlay")).toHaveLength(2);
  });

  it("lets a multi-selection of gates change label and color together", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /^gate$/i }));
    await user.click(screen.getByTestId("grid-cell-0-0"));
    await user.click(screen.getByTestId("grid-cell-0-1"));
    await user.click(screen.getByRole("button", { name: /^select$/i }));

    fireEvent.keyDown(window, { key: "a", ctrlKey: true });
    fireEvent.change(screen.getByLabelText(/gate label/i), {
      target: { value: "H" }
    });
    fireEvent.change(screen.getByLabelText(/element color hex/i), {
      target: { value: "#FF0000" }
    });
    await user.click(screen.getByRole("button", { name: /convert to quantikz/i }));

    const output = (screen.getByLabelText(/quantikz output/i) as HTMLTextAreaElement).value;
    expect(output.match(/\\gate(?:\[[^\]]+\])?\{H\}/g)?.length).toBe(2);
    expect(output).toContain("draw=red");
    expect(output).toContain("label style={text=red}");
  });

  it("lets a mixed multi-selection color a vertical connector and swap crosses together", async () => {
    const user = userEvent.setup();
    render(<App />);

    fireEvent.change(screen.getByLabelText(/quantikz output/i), {
      target: {
        value: String.raw`\begin{quantikz}
& \swap{1} \\
& \targX{}
\end{quantikz}`
      }
    });

    await user.click(screen.getByRole("button", { name: /convert to visual/i }));

    await user.click(screen.getByRole("button", { name: /^select$/i }));
    fireEvent.keyDown(window, { key: "a", ctrlKey: true });

    fireEvent.change(screen.getByLabelText(/element color hex/i), {
      target: { value: "#0000FF" }
    });

    await user.click(screen.getByRole("button", { name: /convert to quantikz/i }));

    const output = (screen.getByLabelText(/quantikz output/i) as HTMLTextAreaElement).value;
    expect(output).toContain("\\swap[style={draw=blue},wire style={draw=blue}]{1}");
    expect(output).toContain("\\targX[style={draw=blue}]{}");
  });

  it("renders colorized target and meter glyphs directly in the visual editor", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(screen.getByRole("button", { name: /^target plus$/i }));
    await user.click(screen.getByTestId("grid-cell-0-0"));
    await user.click(screen.getByRole("button", { name: /^meter$/i }));
    await user.click(screen.getByTestId("grid-cell-0-1"));
    await user.click(screen.getByRole("button", { name: /^select$/i }));

    fireEvent.keyDown(window, { key: "a", ctrlKey: true });
    fireEvent.change(screen.getByLabelText(/element color hex/i), {
      target: { value: "#00FF00" }
    });

    const targetGlyph = container.querySelector(".target-plus") as SVGGElement;
    const targetIcon = container.querySelector(".target-plus-icon") as SVGSVGElement;
    const targetCircle = targetIcon?.querySelector("circle") as SVGCircleElement | null;
    const targetLines = targetIcon?.querySelectorAll("line") ?? [];
    const targetStyle = targetIcon?.querySelector("style");
    const meterGlyph = container.querySelector(".meter-glyph") as SVGSVGElement;

    expect(targetGlyph).toBeTruthy();
    expect(targetGlyph.querySelector("image")).toBeNull();
    expect(targetIcon).toBeTruthy();
    expect(targetCircle).toBeTruthy();
    expect(targetLines).toHaveLength(2);
    expect(targetStyle?.textContent).toContain("stroke: currentColor");
    expect(targetIcon.style.color).toBe("rgb(0, 255, 0)");

    expect(meterGlyph).toBeTruthy();
    expect(meterGlyph.querySelector("image")).toBeNull();
    expect(meterGlyph.querySelector("path")).toBeTruthy();
    expect(meterGlyph.style.color).toBe("rgb(0, 255, 0)");
  });

  it("renders colored wire and swap strokes directly on the SVG primitives", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    fireEvent.change(screen.getByLabelText(/quantikz output/i), {
      target: {
        value: String.raw`\begin{quantikz}
& \swap{1} \\
& \targX{}
\end{quantikz}`
      }
    });

    await user.click(screen.getByRole("button", { name: /convert to visual/i }));
    await user.click(screen.getByRole("button", { name: /^select$/i }));
    fireEvent.keyDown(window, { key: "a", ctrlKey: true });

    fireEvent.change(screen.getByLabelText(/element color hex/i), {
      target: { value: "#0000FF" }
    });

    const connectorLine = container.querySelector(".vertical-connector line") as SVGLineElement;
    const swapIcon = container.querySelector(".swap-x-icon") as SVGSVGElement;

    expect(connectorLine).toBeTruthy();
    expect(connectorLine.style.stroke).toBe("#0000FF");
    expect(swapIcon).toBeTruthy();
    expect(swapIcon.querySelector("line, path")).toBeTruthy();
    expect(swapIcon.style.color).toBe("rgb(0, 0, 255)");
  });

  it("lets a multi-selection of controls switch between c1 and c0 together", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(screen.getByRole("button", { name: /^control dot$/i }));
    await user.click(screen.getByTestId("grid-cell-0-0"));
    await user.click(screen.getByTestId("grid-cell-1-1"));
    await user.click(screen.getByRole("button", { name: /^select$/i }));

    fireEvent.keyDown(window, { key: "a", ctrlKey: true });
    fireEvent.change(screen.getByLabelText(/control type/i), {
      target: { value: "open" }
    });

    expect(container.querySelectorAll(".control-dot-open")).toHaveLength(2);
  });

  it("places an open control when Option is held with the control tool", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(screen.getByRole("button", { name: /^control dot$/i }));
    await user.keyboard("[AltLeft>]");
    await user.click(screen.getByTestId("grid-cell-0-0"));
    await user.keyboard("[/AltLeft]");

    await waitFor(() => expect(container.querySelectorAll(".control-dot-open")).toHaveLength(1));
  });

  it("keeps the selected control overlay hollow for filled controls", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(screen.getByRole("button", { name: /^control dot$/i }));
    await user.click(screen.getByTestId("grid-cell-0-0"));
    await user.click(screen.getByRole("button", { name: /^select$/i }));

    const controlDot = container.querySelector(".control-dot") as SVGCircleElement;
    fireEvent.pointerDown(controlDot, { button: 0 });

    const overlay = container.querySelector(".selected-control-overlay") as SVGCircleElement;
    expect(overlay).toBeTruthy();
    expect(overlay.style.fill).toBe("transparent");
  });

  it("renders gate labels through KaTeX automatically", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(screen.getByRole("button", { name: /^gate$/i }));
    await user.click(screen.getByTestId("grid-cell-0-0"));
    await user.click(screen.getByRole("button", { name: /^select$/i }));

    const gateRect = container.querySelector('rect[data-kind="gate-rect"]') as SVGRectElement;
    fireEvent.pointerDown(gateRect, { button: 0 });
    fireEvent.change(screen.getByLabelText(/gate label/i), {
      target: { value: "\\theta_0" }
    });

    expect(container.querySelector(".gate-label-math .katex")).toBeTruthy();
  });

  it("renders gate bodies above wire segments in the workspace SVG", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(screen.getByRole("button", { name: /^gate$/i }));
    await user.click(screen.getByTestId("grid-cell-0-0"));

    const gateRect = container.querySelector('rect[data-kind="gate-rect"]') as SVGRectElement;
    const wireSegment = container.querySelector(".horizontal-segment-stroke") as SVGElement;

    expect(wireSegment).toBeTruthy();
    expect(wireSegment.compareDocumentPosition(gateRect) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("loads quantikz code from the text box into the visual editor", async () => {
    const user = userEvent.setup();
    render(<App />);

    fireEvent.change(screen.getByLabelText(/quantikz output/i), {
      target: {
        value: String.raw`\begin{quantikz}[row sep={1.1cm,between origins}, column sep=0.8cm]
\lstick{$\ket{0}$} & \gate{H} & \ctrl{1} \\
\lstick{$\ket{\psi}$} & \qw & \targ{}
\end{quantikz}`
      }
    });

    await user.click(screen.getByRole("button", { name: /convert to visual/i }));

    expect(screen.getByRole("textbox", { name: "Qubits" })).toHaveValue("2");
    expect(screen.getByRole("textbox", { name: "Steps" })).toHaveValue("2");
    expect(screen.getByLabelText(/row spacing/i)).toHaveValue("1.1");
    expect(screen.getByLabelText(/column spacing/i)).toHaveValue("0.8");

    await user.click(screen.getByRole("button", { name: /convert to quantikz/i }));

    const exported = (screen.getByLabelText(/quantikz output/i) as HTMLTextAreaElement).value;
    expect(exported).toContain("\\lstick{$\\ket{0}$}");
    expect(exported).toContain("\\lstick{$\\ket{\\psi}$}");
  });

  it("loads \\textsc gate labels into the visual editor and renders them with KaTeX", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    fireEvent.change(screen.getByLabelText(/quantikz output/i), {
      target: {
        value: String.raw`\begin{quantikz}
\lstick{$\ket{0}$} & \gate{\textsc{UNIFORM}}
\end{quantikz}`
      }
    });

    await user.click(screen.getByRole("button", { name: /convert to visual/i }));

    expect(container.querySelector(".gate-label-math .katex")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /convert to quantikz/i }));

    const exported = (screen.getByLabelText(/quantikz output/i) as HTMLTextAreaElement).value;
    expect(exported).toContain("\\gate{\\textsc{UNIFORM}}");
  });

  it("preserves nested ancilla wire overrides when round-tripping through the visual editor", async () => {
    const user = userEvent.setup();
    render(<App />);

    const code = String.raw`\begin{quantikz}[row sep={0.9cm,between origins}, column sep=0.7cm]
\lstick{$\ket{+}_{c_0}$} & \control{} \wire[d][2]{q} &  &  &  &  &  & \control{} \wire[d][2]{q} & \control{} \wire[d][4]{q} &  & \control{} \wire[d][4]{q} & \ctrl{5} &  \\
\lstick{$\ket{+}_{c_1}$} & \control{} &  &  &  &  &  & \ocontrol{} &  &  &  &  &  \\
 & \wireoverride{n} & \control{} \wire[d][2]{q} &  & \ctrl{2} &  & \control{} \wire[d][2]{q} &  & \setwiretype{n} &  &  &  &  \\
\lstick{$\ket{+}_{c_2}$} &  & \control{} &  &  &  & \ocontrol{} &  & \control{} &  & \control{} &  &  \\
 & \setwiretype{n} &  & \ctrl{4} \setwiretype{q} & \targ{} & \ctrl{2} &  & \setwiretype{n} &  & \ctrl{3} \setwiretype{q} &  & \setwiretype{n} &  \\
\lstick{$\ket{\psi_0}$} &  &  &  &  &  &  &  &  &  &  & \gate{A} &  \\
\lstick{$\ket{\psi_1}$} &  &  &  &  & \gate{A} &  &  &  &  &  &  &  \\
\lstick{$\ket{\psi_2}$} &  &  &  &  &  &  &  &  & \gate{A} &  &  &  \\
\lstick{$\ket{\psi_3}$} &  &  & \gate{A} &  &  &  &  &  &  &  &  & 
\end{quantikz}`;

    const normalizeQuantikz = (value: string): string =>
      value
        .replace(/\r\n/g, "\n")
        .split("\n")
        .map((line) => line.replace(/[ \t]+$/g, ""))
        .join("\n");

    fireEvent.change(screen.getByLabelText(/quantikz output/i), {
      target: {
        value: code
      }
    });

    await user.click(screen.getByRole("button", { name: /convert to visual/i }));
    await user.click(screen.getByRole("button", { name: /convert to quantikz/i }));

    const exported = (screen.getByLabelText(/quantikz output/i) as HTMLTextAreaElement).value;
    expect(normalizeQuantikz(exported)).toBe(normalizeQuantikz(code));
  });

  it("splits a standalone document into preamble and quantikz code when loading", async () => {
    const user = userEvent.setup();
    render(<App />);

    fireEvent.change(screen.getByLabelText(/quantikz output/i), {
      target: {
        value: String.raw`\documentclass[tikz,border=8pt]{standalone}
\usepackage{tikz}
\usetikzlibrary{quantikz2}
\newcommand{\foo}{bar}
\begin{document}
\begin{quantikz}
\lstick{$\ket{0}$} & \gate{H}
\end{quantikz}
\end{document}`
      }
    });

    await user.click(screen.getByRole("button", { name: /convert to visual/i }));
    await user.click(screen.getByRole("button", { name: /toggle quantikz editor view/i }));

    expect((screen.getByLabelText(/quantikz preamble/i) as HTMLTextAreaElement).value).toContain(
      String.raw`\newcommand{\foo}{bar}`
    );
    await user.click(screen.getByRole("button", { name: /toggle quantikz editor view/i }));
    expect((screen.getByLabelText(/quantikz output/i) as HTMLTextAreaElement).value).toContain(
      String.raw`\begin{quantikz}`
    );
    expect((screen.getByLabelText(/quantikz output/i) as HTMLTextAreaElement).value).not.toContain(
      String.raw`\begin{document}`
    );
  });

  it("routes pasted quantikz in the export textbox into the preview path", async () => {
    const useRenderedPdfSpy = vi.spyOn(renderedPdfModule, "useRenderedPdf").mockImplementation((code, preamble) => ({
      pdfUrl: code.includes(String.raw`\begin{quantikz}`)
        ? "blob:quantikz-preview"
        : null,
      svgUrl: null,
      svgMarkup: null,
      previewImageUrl: code.includes(String.raw`\begin{quantikz}`)
        ? "blob:quantikz-preview-image"
        : null,
      format: code.includes(String.raw`\begin{quantikz}`) ? "pdf" : null,
      state: code.includes(String.raw`\begin{quantikz}`) ? "ready" : "idle",
      error: null
    }));

    try {
      render(<App />);

      fireEvent.change(screen.getByLabelText(/quantikz output/i), {
        target: {
          value: String.raw`\begin{quantikz}
\lstick{$\ket{0}$} & \gate{H}
\end{quantikz}`
        }
      });

      expect(useRenderedPdfSpy).toHaveBeenCalledWith(
        expect.stringContaining(String.raw`\begin{quantikz}`),
        expect.stringContaining(String.raw`\usetikzlibrary{quantikz2}`)
      );
      expect(screen.getByTitle(/rendered quantikz figure preview/i)).toBeInTheDocument();
      expect(screen.getByTitle(/rendered quantikz figure preview/i)).toHaveAttribute("draggable", "true");
      expect(screen.queryByText(/generate or paste quantikz code/i)).not.toBeInTheDocument();
    } finally {
      useRenderedPdfSpy.mockRestore();
    }
  });

  it("switches the export panel to generated symbolic latex and preview", async () => {
    const user = userEvent.setup();
    const seenRefreshVersions: number[] = [];
    const useRenderedPdfSpy = vi.spyOn(renderedPdfModule, "useRenderedPdf").mockImplementation((code) => ({
      pdfUrl: code.includes(String.raw`\begin{equation*}`) || code.includes(String.raw`\begin{quantikz}`)
        ? "blob:preview"
        : null,
      svgUrl: null,
      svgMarkup: null,
      previewImageUrl: code.includes(String.raw`\begin{equation*}`)
        ? "blob:symbolic-preview-image"
        : code.includes(String.raw`\begin{quantikz}`)
          ? "blob:quantikz-preview-image"
          : null,
      format: (code.includes(String.raw`\begin{equation*}`) || code.includes(String.raw`\begin{quantikz}`)) ? "pdf" : null,
      state: code.includes(String.raw`\begin{equation*}`) || code.includes(String.raw`\begin{quantikz}`) ? "ready" : "idle",
      error: null
    }));
    const useSymbolicLatexSpy = vi.spyOn(symbolicLatexModule, "useSymbolicLatex").mockImplementation((_code, refreshVersion = 0) => {
      seenRefreshVersions.push(refreshVersion);

      return {
        latex: String.raw`\begin{equation*}
\begin{aligned}
\ket{\Psi_{0}} &= \ket{0}
\end{aligned}
\end{equation*}

\noindent\textbf{Slice 1: } apply $H$\par

\begin{equation*}
\begin{aligned}
\ket{\Psi_{1}} &= H\ket{0}
\end{aligned}
 \end{equation*}`,
        state: "ready",
        error: null
      };
    });

    try {
      render(<App />);

      fireEvent.change(screen.getByLabelText(/quantikz output/i), {
        target: {
          value: String.raw`\begin{quantikz}
\lstick{$\ket{0}$} & \gate{H}
\end{quantikz}`
        }
      });

      await user.click(screen.getByRole("button", { name: /^symbolic$/i }));
      expect(seenRefreshVersions.some((version) => version > 0)).toBe(true);

      expect((screen.getByLabelText(/symbolic evolution output/i) as HTMLTextAreaElement).value).toContain(
        String.raw`\ket{\Psi_{1}} &= H\ket{0}`
      );
      expect(useRenderedPdfSpy).toHaveBeenCalledWith(
        expect.stringContaining(String.raw`\begin{equation*}`),
        expect.stringContaining(String.raw`\usepackage{amsmath}`)
      );
      expect(screen.getByTitle(/rendered symbolic evolution preview/i)).toBeInTheDocument();

      const lastSeenRefreshVersion = seenRefreshVersions.at(-1) ?? 0;
      await user.click(screen.getByRole("button", { name: /refresh symbolic evolution/i }));
      await waitFor(() => expect(seenRefreshVersions.at(-1)).toBe(lastSeenRefreshVersion + 1));

      fireEvent.change(screen.getByLabelText(/symbolic evolution output/i), {
        target: {
          value: String.raw`\begin{equation*}
\begin{aligned}
\ket{\Psi_{0}} &= \ket{0}
\end{aligned}
\end{equation*}

\noindent\textbf{Slice 1: } apply $\widetilde{H}$\par

\begin{equation*}
\begin{aligned}
\ket{\Psi_{1}} &= \widetilde{H}\ket{0}
\end{aligned}
\end{equation*}`
        }
      });

      expect((screen.getByLabelText(/symbolic evolution output/i) as HTMLTextAreaElement).value).toContain(
        String.raw`\widetilde{H}\ket{0}`
      );
      await waitFor(() => expect(useRenderedPdfSpy).toHaveBeenCalledWith(
        expect.stringContaining(String.raw`\widetilde{H}\ket{0}`),
        expect.stringContaining(String.raw`\usepackage{amsmath}`)
      ));

      await user.click(screen.getByRole("button", { name: /toggle symbolic editor view/i }));
      expect((screen.getByLabelText(/symbolic preamble/i) as HTMLTextAreaElement).value).toContain(
        String.raw`\documentclass[varwidth=2400pt,border=4pt]{standalone}`
      );
      fireEvent.change(screen.getByLabelText(/symbolic preamble/i), {
        target: {
          value: String.raw`\documentclass[border=6pt]{standalone}
\usepackage{amsmath}
\usepackage{braket}
\newcommand{\foo}{bar}`
        }
      });

      expect((screen.getByLabelText(/symbolic preamble/i) as HTMLTextAreaElement).value).toContain(
        String.raw`\newcommand{\foo}{bar}`
      );
      expect(useRenderedPdfSpy).toHaveBeenCalledWith(
        expect.stringContaining(String.raw`\begin{equation*}`),
        expect.stringContaining(String.raw`\newcommand{\foo}{bar}`)
      );
    } finally {
      useRenderedPdfSpy.mockRestore();
      useSymbolicLatexSpy.mockRestore();
    }
  });

  it("feeds varied-order multi-control slices from the visual editor into symbolic mode", async () => {
    const user = userEvent.setup();
    const seenCodes: string[] = [];
    const useSymbolicLatexSpy = vi.spyOn(symbolicLatexModule, "useSymbolicLatex").mockImplementation((code) => {
      seenCodes.push(code);

      return {
        latex: code.includes("\\targ{}") && code.includes("\\ocontrol{}") && code.includes("\\wire[d][1]{q}")
          ? String.raw`\begin{equation*}
\begin{aligned}
\ket{\Psi_{0}} &= \ket{0} \otimes \ket{0} \otimes \ket{0}
\end{aligned}
\end{equation*}

\noindent\textbf{Slice 1: } controlled $X$ on $a_{0}$\par

\begin{equation*}
\begin{aligned}
\ket{\Psi_{1}} &= \ket{1} \otimes \ket{0} \otimes \ket{0}
\end{aligned}
\end{equation*}`
          : "",
        state: code.trim() ? "ready" : "idle",
        error: null
      };
    });

    try {
      const { container } = render(<App />);
      const board = container.querySelector(".workspace-board") as HTMLDivElement;
      mockBoardRect(board);

      await user.click(screen.getByRole("button", { name: /^target plus$/i }));
      await user.click(screen.getByTestId("grid-cell-0-0"));

      await user.click(screen.getByRole("button", { name: /^control dot$/i }));
      await user.keyboard("[AltLeft>]");
      await user.click(screen.getByTestId("grid-cell-1-0"));
      await user.click(screen.getByTestId("grid-cell-2-0"));
      await user.keyboard("[/AltLeft]");

      await user.click(screen.getByRole("button", { name: /^wires$/i }));
      await user.pointer([
        {
          target: screen.getByTestId("grid-cell-0-0"),
          keys: "[MouseLeft>]",
          coords: {
            x: getCellCenterX(0, DEFAULT_CIRCUIT_LAYOUT),
            y: getRowY(0, DEFAULT_CIRCUIT_LAYOUT)
          }
        },
        { keys: "[/MouseLeft]" },
        {
          target: screen.getByTestId("grid-cell-2-0"),
          keys: "[MouseLeft>]",
          coords: {
            x: getCellCenterX(0, DEFAULT_CIRCUIT_LAYOUT),
            y: getRowY(2, DEFAULT_CIRCUIT_LAYOUT)
          }
        },
        { keys: "[/MouseLeft]" }
      ]);

      await waitFor(() => {
        expect(container.querySelectorAll(".vertical-connector")).toHaveLength(2);
        expect(container.querySelectorAll(".control-dot-open")).toHaveLength(2);
      });

      await user.click(screen.getByRole("button", { name: /convert to quantikz/i }));
      expect((screen.getByLabelText(/quantikz output/i) as HTMLTextAreaElement).value).toContain("\\targ{}");

      await user.click(screen.getByRole("button", { name: /^symbolic$/i }));

      await waitFor(() => {
        expect(seenCodes.some((code) => code.includes("\\targ{}") && code.includes("\\ocontrol{}") && code.includes("\\wire[d][1]{q}"))).toBe(true);
      });
      expect((screen.getByLabelText(/symbolic evolution output/i) as HTMLTextAreaElement).value).toContain(
        String.raw`\ket{\Psi_{1}} &= \ket{1} \otimes \ket{0} \otimes \ket{0}`
      );
    } finally {
      useSymbolicLatexSpy.mockRestore();
    }
  });

  it("feeds the exact c0-c2-target-middle slice from the visual editor into symbolic mode", async () => {
    const user = userEvent.setup();
    const seenCodes: string[] = [];
    const useSymbolicLatexSpy = vi.spyOn(symbolicLatexModule, "useSymbolicLatex").mockImplementation((code) => {
      seenCodes.push(code);

      return {
        latex: code.includes("\\ocontrol{}") && code.includes("\\targ{}") && code.includes("\\wire[d][1]{q}")
          ? String.raw`\begin{equation*}
\begin{aligned}
\ket{\Psi_{0}} &= \ket{0} \otimes \ket{0} \otimes \ket{0}
\end{aligned}
\end{equation*}

\noindent\textbf{Slice 1: } controlled $X$ on $a_{1}$\par

\begin{equation*}
\begin{aligned}
\ket{\Psi_{1}} &= \ket{0} \otimes \ket{1} \otimes \ket{0}
\end{aligned}
\end{equation*}`
          : "",
        state: code.trim() ? "ready" : "idle",
        error: null
      };
    });

    try {
      const { container } = render(<App />);
      const board = container.querySelector(".workspace-board") as HTMLDivElement;
      mockBoardRect(board);

      await user.click(screen.getByRole("button", { name: /^target plus$/i }));
      await user.click(screen.getByTestId("grid-cell-1-0"));

      await user.click(screen.getByRole("button", { name: /^control dot$/i }));
      await user.keyboard("[AltLeft>]");
      await user.click(screen.getByTestId("grid-cell-0-0"));
      await user.click(screen.getByTestId("grid-cell-2-0"));
      await user.keyboard("[/AltLeft]");

      await user.click(screen.getByRole("button", { name: /^wires$/i }));
      await user.pointer([
        {
          target: screen.getByTestId("grid-cell-0-0"),
          keys: "[MouseLeft>]",
          coords: {
            x: getCellCenterX(0, DEFAULT_CIRCUIT_LAYOUT),
            y: getRowY(0, DEFAULT_CIRCUIT_LAYOUT)
          }
        },
        { keys: "[/MouseLeft]" },
        {
          target: screen.getByTestId("grid-cell-2-0"),
          keys: "[MouseLeft>]",
          coords: {
            x: getCellCenterX(0, DEFAULT_CIRCUIT_LAYOUT),
            y: getRowY(2, DEFAULT_CIRCUIT_LAYOUT)
          }
        },
        { keys: "[/MouseLeft]" }
      ]);

      await waitFor(() => {
        expect(container.querySelectorAll(".vertical-connector")).toHaveLength(2);
        expect(container.querySelectorAll(".control-dot-open")).toHaveLength(2);
      });

      await user.click(screen.getByRole("button", { name: /convert to quantikz/i }));
      const quantikz = (screen.getByLabelText(/quantikz output/i) as HTMLTextAreaElement).value;
      expect(quantikz.match(/\\ocontrol\{\}/g)?.length).toBe(2);
      expect(quantikz).toContain("\\targ{}");
      expect(quantikz.match(/\\wire\[d\]\[1\]\{q\}/g)?.length).toBeGreaterThanOrEqual(2);

      await user.click(screen.getByRole("button", { name: /^symbolic$/i }));

      await waitFor(() => {
        expect(seenCodes.some((code) => code.includes("\\ocontrol{}") && code.includes("\\targ{}") && code.includes("\\wire[d][1]{q}"))).toBe(true);
      });
      expect((screen.getByLabelText(/symbolic evolution output/i) as HTMLTextAreaElement).value).toContain(
        String.raw`\ket{\Psi_{1}} &= \ket{0} \otimes \ket{1} \otimes \ket{0}`
      );
    } finally {
      useSymbolicLatexSpy.mockRestore();
    }
  });

  it("copies the rendered figure to the clipboard", async () => {
    const user = userEvent.setup();
    const pdfBlob = new Blob(["%PDF-test"], { type: "application/pdf" });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(pdfBlob, {
        status: 200,
        headers: { "Content-Type": "application/pdf" }
      })
    );
    const clipboardWrite = vi.fn().mockResolvedValue(undefined);
    const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    const originalClipboardItem = globalThis.ClipboardItem;

    class MockClipboardItem {
      readonly items: Record<string, Blob>;

      constructor(items: Record<string, Blob>) {
        this.items = items;
      }
    }

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { write: clipboardWrite }
    });
    Object.defineProperty(globalThis, "ClipboardItem", {
      configurable: true,
      value: MockClipboardItem
    });

    try {
      render(<App />);

      fireEvent.change(screen.getByLabelText(/quantikz output/i), {
        target: {
          value: String.raw`\begin{quantikz}
\lstick{$\ket{0}$} & \gate{H}
\end{quantikz}`
        }
      });

      await user.click(screen.getByRole("button", { name: /copy image/i }));

      const clipboardItems = clipboardWrite.mock.calls[0]?.[0] as MockClipboardItem[];

      expect(fetchMock).toHaveBeenCalledWith(
        "/api/render-pdf",
        expect.objectContaining({ method: "POST" })
      );
      expect(clipboardWrite).toHaveBeenCalledTimes(1);
      expect(clipboardItems).toHaveLength(1);
      const copiedBlob = clipboardItems[0]?.items["image/png"];
      expect(copiedBlob.type).toBe("image/png");
      expect(copiedBlob.size).toBeGreaterThan(0);
    } finally {
      fetchMock.mockRestore();

      if (originalClipboardDescriptor) {
        Object.defineProperty(navigator, "clipboard", originalClipboardDescriptor);
      } else {
        Reflect.deleteProperty(navigator as { clipboard?: Navigator["clipboard"] }, "clipboard");
      }

      if (typeof originalClipboardItem === "undefined") {
        delete (globalThis as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
      } else {
        Object.defineProperty(globalThis, "ClipboardItem", {
          configurable: true,
          value: originalClipboardItem
        });
      }
    }
  });

  it("submits a bug report with the current Quantikz source attached", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        success: true,
        id: "bug-123",
        submittedAt: "2026-03-25T12:00:00.000Z"
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );

    try {
      render(<App />);

      fireEvent.change(screen.getByLabelText(/quantikz output/i), {
        target: {
          value: String.raw`\begin{quantikz}
\lstick{$\ket{0}$} & \gate{H}
\end{quantikz}`
        }
      });

      await user.click(screen.getByRole("button", { name: /submit a bug/i }));
      await user.type(screen.getByLabelText(/bug title/i), "Preview crops bottom wire");
      await user.type(screen.getByLabelText(/bug description/i), "The preview image cuts off the last row after export.");
      await user.click(screen.getByRole("button", { name: /^submit bug$/i }));

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          "/api/bug-report",
          expect.objectContaining({ method: "POST" })
        );
      });

      const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
      const payload = JSON.parse(String(request.body));

      expect(payload.title).toBe("Preview crops bottom wire");
      expect(payload.description).toBe("The preview image cuts off the last row after export.");
      expect(payload.code).toContain(String.raw`\begin{quantikz}`);
      expect(typeof payload.visualCircuitSnapshot).toBe("string");
      expect(JSON.parse(payload.visualCircuitSnapshot)).toEqual(expect.objectContaining({
        summary: expect.objectContaining({
          qubits: 3,
          steps: 5
        }),
        editorState: expect.objectContaining({
          qubits: 3,
          steps: 5
        })
      }));
      expect(screen.queryByRole("dialog", { name: /submit a bug/i })).not.toBeInTheDocument();
      expect(screen.getByText(/bug report submitted\./i)).toBeInTheDocument();
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("restores a reported circuit from a bug-report restore token", async () => {
    const restoreId = "restore-test";
    const restoreStorageKey = buildBugReportRestoreStorageKey(restoreId);
    const previousPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;

    window.localStorage.setItem(restoreStorageKey, JSON.stringify({
      editorState: {
        ...initialState,
        qubits: 4,
        steps: 6,
        items: [{
          id: "gate-restore-1",
          type: "gate",
          point: { row: 1, col: 2 },
          span: { rows: 1, cols: 1 },
          label: "R",
          width: 40,
          color: null
        }],
        wireMask: {},
        wireTypes: ["quantum", "classical", "quantum", "quantum"],
        wireLabels: [
          { left: "a", right: "" },
          { left: "", right: "" },
          { left: "", right: "" },
          { left: "", right: "out" }
        ],
        selectedItemIds: [],
        exportCode: String.raw`\begin{quantikz}
& & \gate{R}
\end{quantikz}`,
        exportPreamble: initialState.exportPreamble,
        exportSymbolicPreamble: initialState.exportSymbolicPreamble,
        exportIssues: [],
        uiMessage: null
      },
      code: String.raw`\begin{quantikz}
& & \gate{R}
\end{quantikz}`,
      preamble: initialState.exportPreamble,
      exportPanelMode: "quantikz",
      quantikzPaneView: "content",
      symbolicPaneView: "content",
      symbolicEditorCode: ""
    }));
    window.history.replaceState({}, "", `/?${BUG_REPORT_RESTORE_SEARCH_PARAM}=${restoreId}`);

    try {
      render(<App />);

      await waitFor(() => expect(screen.getByLabelText(/^qubits$/i)).toHaveValue("4"));
      await waitFor(() => expect(screen.getByLabelText(/^steps$/i)).toHaveValue("6"));
      expect((screen.getByLabelText(/quantikz output/i) as HTMLTextAreaElement).value).toContain("\\gate{R}");
      expect(screen.getByText(/circuit restored from bug report\./i)).toBeInTheDocument();
      const restoredSearchParams = new URLSearchParams(window.location.search);
      expect(restoredSearchParams.has(BUG_REPORT_RESTORE_SEARCH_PARAM)).toBe(false);
      // The code is now compressed in the URL, so just verify the parameter exists
      expect(restoredSearchParams.get(SHARE_CODE_SEARCH_PARAM)).toBeTruthy();
      expect(window.localStorage.getItem(restoreStorageKey)).toBeNull();
    } finally {
      window.localStorage.removeItem(restoreStorageKey);
      window.history.replaceState({}, "", previousPath || "/");
    }
  });

  it("loads a shared circuit from the URL", async () => {
    const previousPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const sharedCode = String.raw`\begin{quantikz}
& \gate{H}
\end{quantikz}`;
    const compressedCode = compressPayload(sharedCode, "");

    window.history.replaceState({}, "", `/?${SHARE_CODE_SEARCH_PARAM}=${encodeURIComponent(compressedCode)}`);

    try {
      render(<App />);

      await waitFor(() => {
        expect((screen.getByLabelText(/quantikz output/i) as HTMLTextAreaElement).value).toContain("\\gate{H}");
      });
      expect(screen.getByText(/quantikz code loaded into the visual editor\./i)).toBeInTheDocument();
    } finally {
      window.history.replaceState({}, "", previousPath || "/");
    }
  });

  it("keeps malformed shared code in the editor and URL", async () => {
    const previousPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const invalidSharedCode = String.raw`\begin{quantikz}
& \gate{H
\end{quantikz}`;
    const compressedCode = compressPayload(invalidSharedCode, "");

    window.history.replaceState({}, "", `/?${SHARE_CODE_SEARCH_PARAM}=${encodeURIComponent(compressedCode)}`);

    try {
      render(<App />);

      await waitFor(() => {
        expect((screen.getByLabelText(/quantikz output/i) as HTMLTextAreaElement).value).toBe(invalidSharedCode);
      });
      expect(screen.getByText(/left in the editor so you can fix it\./i)).toBeInTheDocument();
      // The URL now contains compressed data, so just check that the parameter exists
      expect(new URLSearchParams(window.location.search).get(SHARE_CODE_SEARCH_PARAM)).toBeTruthy();
    } finally {
      window.history.replaceState({}, "", previousPath || "/");
    }
  });

  it("writes generated quantikz code into the URL", async () => {
    const user = userEvent.setup();
    const previousPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;

    window.history.replaceState({}, "", "/");

    try {
      render(<App />);

      await user.click(screen.getByRole("button", { name: /^gate$/i }));
      await user.click(screen.getByTestId("grid-cell-0-0"));
      await user.click(screen.getByRole("button", { name: /convert to quantikz/i }));

      await waitFor(() => {
        // The code is now compressed in the URL, so just verify the parameter exists
        expect(new URLSearchParams(window.location.search).get(SHARE_CODE_SEARCH_PARAM)).toBeTruthy();
      });
    } finally {
      window.history.replaceState({}, "", previousPath || "/");
    }
  });

  it("copies the shared URL to the clipboard", async () => {
    const user = userEvent.setup();
    const previousPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const writeText = vi.fn(async () => undefined);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : String(input.url);

      if (url.endsWith("/api/render-pdf")) {
        return new Response(new Blob(["%PDF"], { type: "application/pdf" }), {
          status: 200,
          headers: { "Content-Type": "application/pdf" }
        });
      }

      if (url.endsWith("/api/share-preview-image")) {
        return new Response(JSON.stringify({ success: true, imageId: "preview-1.png" }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }

      if (url.endsWith("/api/store-share-code")) {
        return new Response(JSON.stringify({ success: true, id: "tiny123" }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }

      return new Response(JSON.stringify({ success: false, error: "Unexpected request" }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    });

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText
      }
    });

    window.history.replaceState({}, "", "/");

    try {
      render(<App />);

      fireEvent.change(screen.getByLabelText(/quantikz output/i), {
        target: {
          value: String.raw`\begin{quantikz}
& \gate{H}
\end{quantikz}`
        }
      });

      await user.click(screen.getByRole("button", { name: /copy share url/i }));

      await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
      const copiedUrl = writeText.mock.calls.at(0)?.at(0);
      expect(copiedUrl).toContain("/api/share?");
      expect(copiedUrl).toContain(`${SHARE_CODE_ID_SEARCH_PARAM}=tiny123`);
      expect(copiedUrl).not.toContain(`${SHARE_CODE_SEARCH_PARAM}=`);
      expect(copiedUrl).not.toContain("img=");
      expect(screen.getByText(/share URL copied with a rendered preview image\./i)).toBeInTheDocument();
    } finally {
      fetchMock.mockRestore();
      window.history.replaceState({}, "", previousPath || "/");
    }
  });

  it("shows the bug description counter inside the submit dialog", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /submit a bug/i }));
    await user.type(screen.getByLabelText(/bug description/i), "abc");

    expect(screen.getByText(`3/${BUG_REPORT_DESCRIPTION_MAX_LENGTH}`)).toBeInTheDocument();
  });

  it("pastes a copied selection back into the circuit", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    const board = container.querySelector(".workspace-board") as HTMLDivElement;
    const workbench = screen.getByLabelText(/circuit workbench/i);
    mockBoardRect(board);

    await user.click(screen.getByRole("button", { name: /^gate$/i }));
    await user.click(screen.getByTestId("grid-cell-0-0"));
    await user.click(screen.getByRole("button", { name: /^select$/i }));

    const gateRect = container.querySelector('rect[data-kind="gate-rect"]') as SVGRectElement;
    fireEvent.pointerDown(gateRect, { button: 0 });

    fireEvent.keyDown(window, { key: "c", ctrlKey: true });
    fireEvent.keyDown(window, { key: "v", ctrlKey: true });

    fireEvent.pointerMove(workbench, {
      clientX: getCellCenterX(2, DEFAULT_CIRCUIT_LAYOUT),
      clientY: getRowY(1, DEFAULT_CIRCUIT_LAYOUT)
    });
    fireEvent.click(workbench, {
      clientX: getCellCenterX(2, DEFAULT_CIRCUIT_LAYOUT),
      clientY: getRowY(1, DEFAULT_CIRCUIT_LAYOUT)
    });

    expect(container.querySelectorAll('rect[data-kind="gate-rect"]')).toHaveLength(2);
  });

  it("turns deleted horizontal lines into setwiretype gaps", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(screen.getByRole("button", { name: /unlock wires/i }));
    await user.click(screen.getByRole("button", { name: /^select$/i }));
    await user.click(screen.getByTestId("segment-slot-0-1"));

    expect(screen.getByLabelText(/classical wire/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/bundle wire/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /delete selected/i }));
    await user.click(screen.getByRole("button", { name: /convert to quantikz/i }));

    expect(container.querySelector(".absent-override")).toBeNull();
    expect((screen.getByLabelText(/quantikz output/i) as HTMLTextAreaElement).value).toContain("\\setwiretype{n}");
  });

  it("lets a selected horizontal segment switch to classical wire style", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /unlock wires/i }));
    await user.click(screen.getByRole("button", { name: /^select$/i }));
    await user.click(screen.getByTestId("segment-slot-0-1"));

    fireEvent.click(screen.getByLabelText(/classical wire/i));

    await user.click(screen.getByRole("button", { name: /convert to quantikz/i }));
    expect((screen.getByLabelText(/quantikz output/i) as HTMLTextAreaElement).value).toContain("\\wireoverride{c}");
  });

  it("lets a selected horizontal segment switch on bundle text", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(screen.getByRole("button", { name: /unlock wires/i }));
    await user.click(screen.getByRole("button", { name: /^select$/i }));
    await user.click(screen.getByTestId("segment-slot-0-1"));

    fireEvent.click(screen.getByLabelText(/bundle wire/i));
    await user.clear(screen.getByLabelText(/bundle label/i));
    await user.type(screen.getByLabelText(/bundle label/i), "2N_a");

    const bundleLabel = container.querySelector(".horizontal-segment-bundle-label-math");
    expect(bundleLabel?.textContent?.replace(/\s+/g, "")).toContain("2N");

    await user.click(screen.getByRole("button", { name: /convert to quantikz/i }));
    expect((screen.getByLabelText(/quantikz output/i) as HTMLTextAreaElement).value).toContain("\\qwbundle{2N_a}");
  });

  it("uses a 20px selection band for horizontal wires", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(screen.getByRole("button", { name: /unlock wires/i }));
    await user.click(screen.getByRole("button", { name: /^select$/i }));
    await user.click(screen.getByTestId("segment-slot-0-1"));

    const outline = container.querySelector(".item-outline-selected") as SVGRectElement;
    expect(outline).toBeTruthy();
    expect(outline.getAttribute("height")).toBe("20");
  });

  it("does not select a horizontal segment while wires are locked", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /^select$/i }));
    await user.click(screen.getByTestId("segment-slot-0-1"));

    expect(screen.queryByLabelText(/classical wire/i)).toBeNull();
    expect(screen.queryByLabelText(/bundle wire/i)).toBeNull();
  });

  it("drags a selected horizontal segment from the wide slot hit area", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    const board = container.querySelector(".workspace-board") as HTMLDivElement;
    mockBoardRect(board);

    await user.click(screen.getByRole("button", { name: /unlock wires/i }));
    await user.click(screen.getByRole("button", { name: /^select$/i }));
    await user.click(screen.getByTestId("segment-slot-0-1"));

    const [destinationX1, destinationX2] = getIncomingSegmentRange(3, 5, DEFAULT_CIRCUIT_LAYOUT);

    await user.pointer([
      {
        target: screen.getByTestId("segment-slot-0-1"),
        keys: "[MouseLeft>]",
        coords: {
          x: getCellCenterX(1, DEFAULT_CIRCUIT_LAYOUT) - 18,
          y: getRowY(0, DEFAULT_CIRCUIT_LAYOUT)
        }
      },
      {
        target: board,
        coords: {
          x: (destinationX1 + destinationX2) / 2,
          y: getRowY(1, DEFAULT_CIRCUIT_LAYOUT)
        }
      },
      { keys: "[/MouseLeft]" }
    ]);

    await waitFor(() => {
      const outline = container.querySelector(".item-outline-selected") as SVGRectElement;
      expect(outline).toBeTruthy();
      expect(Number(outline.getAttribute("x"))).toBeCloseTo(destinationX1, 5);
      expect(Number(outline.getAttribute("y"))).toBeCloseTo(getRowY(1, DEFAULT_CIRCUIT_LAYOUT) - 10, 5);
    });
  });

  it("starts dragging an unlocked horizontal segment on the first click-drag gesture", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    const board = container.querySelector(".workspace-board") as HTMLDivElement;
    mockBoardRect(board);

    await user.click(screen.getByRole("button", { name: /unlock wires/i }));
    await user.click(screen.getByRole("button", { name: /^select$/i }));

    const [destinationX1, destinationX2] = getIncomingSegmentRange(4, 5, DEFAULT_CIRCUIT_LAYOUT);

    await user.pointer([
      {
        target: screen.getByTestId("segment-slot-0-1"),
        keys: "[MouseLeft>]",
        coords: {
          x: getCellCenterX(1, DEFAULT_CIRCUIT_LAYOUT) - 18,
          y: getRowY(0, DEFAULT_CIRCUIT_LAYOUT)
        }
      },
      {
        target: board,
        coords: {
          x: (destinationX1 + destinationX2) / 2,
          y: getRowY(2, DEFAULT_CIRCUIT_LAYOUT)
        }
      },
      { keys: "[/MouseLeft]" }
    ]);

    await waitFor(() => {
      const outline = container.querySelector(".item-outline-selected") as SVGRectElement;
      expect(outline).toBeTruthy();
      expect(Number(outline.getAttribute("x"))).toBeCloseTo(destinationX1, 5);
      expect(Number(outline.getAttribute("y"))).toBeCloseTo(getRowY(2, DEFAULT_CIRCUIT_LAYOUT) - 10, 5);
    });

    await user.click(screen.getByRole("button", { name: /convert to quantikz/i }));
    expect((screen.getByLabelText(/quantikz output/i) as HTMLTextAreaElement).value).toContain("\\setwiretype{n}");
  });

  it("starts marquee selection from a locked horizontal wire hit area", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    const board = container.querySelector(".workspace-board") as HTMLDivElement;
    mockBoardRect(board);

    await user.click(screen.getByRole("button", { name: /^gate$/i }));
    await user.click(screen.getByTestId("grid-cell-0-0"));
    await user.click(screen.getByRole("button", { name: /^select$/i }));

    await user.pointer([
      {
        target: screen.getByTestId("segment-slot-0-1"),
        keys: "[MouseLeft>]",
        coords: {
          x: getCellCenterX(1, DEFAULT_CIRCUIT_LAYOUT) - 18,
          y: getRowY(0, DEFAULT_CIRCUIT_LAYOUT)
        }
      },
      {
        target: board,
        coords: {
          x: getCellCenterX(0, DEFAULT_CIRCUIT_LAYOUT) - 32,
          y: getRowY(0, DEFAULT_CIRCUIT_LAYOUT) + 28
        }
      },
      { keys: "[/MouseLeft]" }
    ]);

    await waitFor(() => {
      expect(screen.getByText(/object controls/i)).toBeInTheDocument();
    });
    expect(screen.getByLabelText(/gate label/i)).toBeInTheDocument();
  });

  it("starts marquee selection from a meter-suppressed horizontal slot", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    const board = container.querySelector(".workspace-board") as HTMLDivElement;
    mockBoardRect(board);

    await user.click(screen.getByRole("button", { name: /^meter$/i }));
    await user.click(screen.getByTestId("grid-cell-0-0"));
    await user.click(screen.getByRole("button", { name: /^gate$/i }));
    await user.click(screen.getByTestId("grid-cell-0-2"));
    await user.click(screen.getByRole("button", { name: /^select$/i }));

    await user.pointer([
      {
        target: screen.getByTestId("segment-slot-0-1"),
        keys: "[MouseLeft>]",
        coords: {
          x: getCellCenterX(1, DEFAULT_CIRCUIT_LAYOUT) - 18,
          y: getRowY(0, DEFAULT_CIRCUIT_LAYOUT)
        }
      },
      {
        target: board,
        coords: {
          x: getCellCenterX(2, DEFAULT_CIRCUIT_LAYOUT) + 30,
          y: getRowY(0, DEFAULT_CIRCUIT_LAYOUT) + 28
        }
      },
      { keys: "[/MouseLeft]" }
    ]);

    await waitFor(() => {
      expect(screen.getByText(/object controls/i)).toBeInTheDocument();
    });
    expect(screen.getByLabelText(/gate label/i)).toBeInTheDocument();
  });

  it("automatically removes only the horizontal wires to the right of a meter", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(screen.getByRole("button", { name: /^meter$/i }));
    await user.click(screen.getByTestId("grid-cell-0-0"));
    await user.click(screen.getByRole("button", { name: /convert to quantikz/i }));

    expect(container.querySelectorAll(".absent-override").length).toBe(0);
    const output = (screen.getByLabelText(/quantikz output/i) as HTMLTextAreaElement).value;

    expect(output).toContain("\\meter{}");
    expect(output).not.toContain("\\setwiretype{n}");
  });

  it("lets you redraw a wire to the right of a meter", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    const board = container.querySelector(".workspace-board") as HTMLDivElement;
    mockBoardRect(board);

    await user.click(screen.getByRole("button", { name: /^meter$/i }));
    await user.click(screen.getByTestId("grid-cell-0-0"));

    await user.click(screen.getByRole("button", { name: /^wires$/i }));

    await user.pointer([
      {
        target: screen.getByTestId("segment-slot-0-1"),
        keys: "[MouseLeft>]",
        coords: {
          x: getCellCenterX(1, DEFAULT_CIRCUIT_LAYOUT),
          y: getRowY(0, DEFAULT_CIRCUIT_LAYOUT)
        }
      },
      { keys: "[/MouseLeft]" },
      {
        target: screen.getByTestId("segment-slot-0-2"),
        keys: "[MouseLeft>]",
        coords: {
          x: getCellCenterX(2, DEFAULT_CIRCUIT_LAYOUT),
          y: getRowY(0, DEFAULT_CIRCUIT_LAYOUT)
        }
      },
      { keys: "[/MouseLeft]" }
    ]);

    await user.click(screen.getByRole("button", { name: /convert to quantikz/i }));

    await waitFor(() => {
      const output = (screen.getByLabelText(/quantikz output/i) as HTMLTextAreaElement).value;

      expect(output).toContain("\\meter{}");
      expect(output).toContain("\\wireoverride{c}");
    });
  });

  it("shows boundary guide points in wire mode and redraws a left half wire from the circuit edge", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    const board = container.querySelector(".workspace-board") as HTMLDivElement;
    mockBoardRect(board);

    await user.click(screen.getByRole("button", { name: /unlock wires/i }));
    await user.click(screen.getByRole("button", { name: /^select$/i }));
    await user.click(screen.getByTestId("segment-slot-0-0"));
    await user.click(screen.getByRole("button", { name: /delete selected/i }));

    await user.click(screen.getByRole("button", { name: /^wires$/i }));
    expect(screen.getByTestId("pencil-guide-boundary-left-0")).toBeInTheDocument();
    expect(screen.getByTestId("pencil-guide-boundary-right-0")).toBeInTheDocument();

    await user.pointer([
      {
        target: board,
        coords: {
          x: getWireStartX(),
          y: getRowY(0, DEFAULT_CIRCUIT_LAYOUT)
        },
        keys: "[MouseLeft]"
      },
      {
        target: board,
        coords: {
          x: getCellCenterX(0, DEFAULT_CIRCUIT_LAYOUT),
          y: getRowY(0, DEFAULT_CIRCUIT_LAYOUT)
        },
        keys: "[MouseLeft]"
      }
    ]);

    await user.click(screen.getByRole("button", { name: /convert to quantikz/i }));
    const output = (screen.getByLabelText(/quantikz output/i) as HTMLTextAreaElement).value;

    expect(output).not.toContain("\\setwiretype{n}");
  }, 15000);

  it("can grow the grid without auto-wiring the new row and column", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /auto wires/i }));
    await user.click(screen.getByRole("button", { name: /increase qubits/i }));
    await user.click(screen.getByRole("button", { name: /increase steps/i }));
    await user.click(screen.getByRole("button", { name: /convert to quantikz/i }));

    const output = (screen.getByLabelText(/quantikz output/i) as HTMLTextAreaElement).value;

    expect(output).toContain("\\setwiretype{n}");
    expect(output).not.toContain("\\qw");
  });

  it("shows row numbers on the far left of the circuit", () => {
    const { container } = render(<App />);
    expect(container.querySelectorAll(".grid-row-label")).toHaveLength(3);
  });

  it("lets grid number inputs be cleared and retyped", async () => {
    const user = userEvent.setup();
    render(<App />);

    const qubitsInput = screen.getByRole("textbox", { name: "Qubits" });

    await user.click(qubitsInput);
    await user.keyboard("{Backspace}4");

    expect(qubitsInput).toHaveValue("4");
  });

  it("switches tools from the keyboard shortcuts", () => {
    render(<App />);

    fireEvent.keyDown(window, { key: "g" });
    expect(screen.getByRole("button", { name: /^gate$/i })).toHaveAttribute("aria-pressed", "true");

    fireEvent.keyDown(window, { key: "w" });
    expect(screen.getByRole("button", { name: /^wires$/i })).toHaveAttribute("aria-pressed", "true");

    fireEvent.keyDown(window, { key: "s" });
    expect(screen.getByRole("button", { name: /^swap x$/i })).toHaveAttribute("aria-pressed", "true");

    fireEvent.keyDown(window, { key: "v" });
    expect(screen.getByRole("button", { name: /^select$/i })).toHaveAttribute("aria-pressed", "true");
  });

  it("converts the current circuit with Ctrl/Cmd+S", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /^gate$/i }));
    await user.click(screen.getByTestId("grid-cell-0-0"));

    const output = screen.getByLabelText(/quantikz output/i) as HTMLTextAreaElement;
    fireEvent.keyDown(output, { key: "s", ctrlKey: true });

    expect(output.value).toContain("\\gate{U}");
  });

  it("converts the current circuit with Ctrl/Cmd+Enter", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /^gate$/i }));
    await user.click(screen.getByTestId("grid-cell-0-0"));

    const output = screen.getByLabelText(/quantikz output/i) as HTMLTextAreaElement;
    fireEvent.keyDown(output, { key: "Enter", ctrlKey: true });

    expect(output.value).toContain("\\gate{U}");
  });

  it("converts the current circuit with Enter outside form fields", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /^gate$/i }));
    await user.click(screen.getByTestId("grid-cell-0-0"));

    const output = screen.getByLabelText(/quantikz output/i) as HTMLTextAreaElement;
    fireEvent.keyDown(window, { key: "Enter" });

    expect(output.value).toContain("\\gate{U}");
  });

  it("does not hijack Enter while editing the export textarea", () => {
    render(<App />);

    const output = screen.getByLabelText(/quantikz output/i) as HTMLTextAreaElement;
    fireEvent.keyDown(output, { key: "Enter" });

    expect(output.value).toBe("");
  });

  it("shows the shortcuts sheet from the Cmd launcher and closes it with Escape", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /show keyboard shortcuts/i }));

    const dialog = screen.getByRole("dialog", { name: /shortcuts/i });

    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText(/tool switching/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/^cmd\/ctrl \+ c$/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/^v$/i)).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: /shortcuts/i })).not.toBeInTheDocument();
  });

  it("shows symbolic conventions from the Help button while the symbolic export mode is active", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /^symbolic$/i }));
    await user.click(screen.getByRole("button", { name: /show symbolic conventions/i }));

    const dialog = screen.getByRole("dialog", { name: /symbolic interpretation/i });

    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText(/recognized states/i)).toBeInTheDocument();
    expect(within(dialog).getByText(String.raw`\ket{0}, \ket{1}, \ket{+}, \ket{-}, \ket{i}, \ket{-i}, \ket{T}`)).toBeInTheDocument();
    expect(within(dialog).getByText(String.raw`\ket{0}_{c_0}, \ket{\psi}_{data}`)).toBeInTheDocument();
    expect(within(dialog).getByText(String.raw`\textsc{UNIFORM}_M, \textsc{UNIFORM}`)).toBeInTheDocument();
    expect(within(dialog).getByText(/normalized symbolic sum/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/copied by a later controlled x/i)).toBeInTheDocument();
    expect(within(dialog).getByText(String.raw`R_X(\theta), R_Y(\theta), R_Z(\theta)`)).toBeInTheDocument();
    expect(within(dialog).getByText(/each independent wire stays separated/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/generated on the server/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/needs a local Python runtime/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/not currently executed directly in the browser/i)).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: /^shortcuts$/i }));

    expect(screen.getByRole("dialog", { name: /shortcuts/i })).toBeInTheDocument();
    expect(within(screen.getByRole("dialog", { name: /shortcuts/i })).getByText(/tool switching/i)).toBeInTheDocument();
  });

  it("opens the cached export history with H and loads an entry into the export panel", async () => {
    window.localStorage.clear();
    window.localStorage.setItem(
      "quantikzz.export-history.v1",
      JSON.stringify([
        {
          id: "history-1",
          createdAt: "2026-03-15T10:00:00.000Z",
          code: "\\begin{quantikz}\n\\lstick{$\\\\ket{0}$} & \\gate{H}\n\\end{quantikz}",
          preamble: "\\documentclass{standalone}\n\\usetikzlibrary{quantikz2}",
          previewImage: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WnJ1l8AAAAASUVORK5CYII="
        }
      ])
    );

    const user = userEvent.setup();
    const { container } = render(<App />);

    fireEvent.keyDown(window, { key: "h" });

    const dialog = screen.getByRole("dialog", { name: /history/i });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText(/\\begin\{quantikz\}/)).toBeInTheDocument();
    expect(dialog.querySelector('.history-card-preview-image[src^="data:image/png"]')).toBeTruthy();

    await user.click(within(dialog).getByRole("button", { name: /\\begin\{quantikz\}/ }));

    expect(screen.queryByRole("dialog", { name: /history/i })).not.toBeInTheDocument();
    expect((screen.getByLabelText(/quantikz output/i) as HTMLTextAreaElement).value).toContain("\\gate{H}");
    expect(container.querySelector('rect[data-kind="gate-rect"]')).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /toggle quantikz editor view/i }));
    expect((screen.getByLabelText(/quantikz preamble/i) as HTMLTextAreaElement).value).toContain("\\usetikzlibrary{quantikz2}");
  });

  it("lets a selected control switch to an open c0 control", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(screen.getByRole("button", { name: /^control dot$/i }));
    await user.click(screen.getByTestId("grid-cell-0-0"));
    await user.click(screen.getByRole("button", { name: /^select$/i }));

    const controlDot = container.querySelector(".control-dot") as SVGCircleElement;
    fireEvent.pointerDown(controlDot, { button: 0 });

    fireEvent.change(screen.getByLabelText(/control type/i), {
      target: { value: "open" }
    });

    await user.click(screen.getByRole("button", { name: /convert to quantikz/i }));

    expect(container.querySelector(".control-dot-open")).toBeTruthy();
    expect((screen.getByLabelText(/quantikz output/i) as HTMLTextAreaElement).value).toContain("\\ocontrol{}");
  });

  it("marks incomplete swap endpoints red and shows the reason on hover", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(screen.getByRole("button", { name: /^swap x$/i }));
    await user.click(screen.getByTestId("grid-cell-0-0"));
    await user.click(screen.getByRole("button", { name: /^wires$/i }));
    await user.click(screen.getByTestId("grid-cell-0-0"));
    await user.click(screen.getByTestId("grid-cell-1-0"));

    const invalidSwap = container.querySelector(".swap-x.is-invalid") as SVGGElement;
    expect(invalidSwap).toBeTruthy();

    fireEvent.pointerEnter(invalidSwap.closest(".item-group") as SVGGElement, { clientX: 120, clientY: 140 });

    expect(screen.getByText(/connect this swap x to one other swap x/i)).toBeInTheDocument();
  });

  it("creates a vertical connector between two clicked grid points", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    const board = container.querySelector(".workspace-board") as HTMLDivElement;
    mockBoardRect(board);

    await user.click(screen.getByRole("button", { name: /^wires$/i }));
    await user.pointer([
      {
        target: screen.getByTestId("grid-cell-0-0"),
        keys: "[MouseLeft>]",
        coords: {
          x: getCellCenterX(0, DEFAULT_CIRCUIT_LAYOUT),
          y: getRowY(0, DEFAULT_CIRCUIT_LAYOUT)
        }
      },
      { keys: "[/MouseLeft]" },
      {
        target: screen.getByTestId("grid-cell-2-0"),
        keys: "[MouseLeft>]",
        coords: {
          x: getCellCenterX(0, DEFAULT_CIRCUIT_LAYOUT),
          y: getRowY(2, DEFAULT_CIRCUIT_LAYOUT)
        }
      },
      { keys: "[/MouseLeft]" }
    ]);

    await waitFor(() => {
      expect(container.querySelectorAll(".vertical-connector")).toHaveLength(2);
    });
  });

  it("lets you select a vertical connector from near the wire", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    const board = container.querySelector(".workspace-board") as HTMLDivElement;
    mockBoardRect(board);

    await user.click(screen.getByRole("button", { name: /^wires$/i }));
    await user.pointer([
      {
        target: screen.getByTestId("grid-cell-0-0"),
        keys: "[MouseLeft>]",
        coords: {
          x: getCellCenterX(0, DEFAULT_CIRCUIT_LAYOUT),
          y: getRowY(0, DEFAULT_CIRCUIT_LAYOUT)
        }
      },
      { keys: "[/MouseLeft]" },
      {
        target: screen.getByTestId("grid-cell-2-0"),
        keys: "[MouseLeft>]",
        coords: {
          x: getCellCenterX(0, DEFAULT_CIRCUIT_LAYOUT),
          y: getRowY(2, DEFAULT_CIRCUIT_LAYOUT)
        }
      },
      { keys: "[/MouseLeft]" }
    ]);

    await waitFor(() => {
      expect(container.querySelectorAll(".vertical-connector")).toHaveLength(2);
    });

    await user.click(screen.getByRole("button", { name: /^select$/i }));

    const hitTarget = container.querySelector(".vertical-connector-hit") as SVGLineElement;
    fireEvent.pointerDown(hitTarget, {
      button: 0,
      clientX: getCellCenterX(0, DEFAULT_CIRCUIT_LAYOUT) + 9,
      clientY: (getRowY(0, DEFAULT_CIRCUIT_LAYOUT) + getRowY(1, DEFAULT_CIRCUIT_LAYOUT)) / 2
    });

    await waitFor(() => {
      expect(screen.getByText(/object controls/i)).toBeInTheDocument();
    });
    expect(screen.getByLabelText(/vertical wire style/i)).toBeInTheDocument();

    const outline = container.querySelector(".item-outline-selected") as SVGRectElement;
    expect(outline).toBeTruthy();
    expect(outline.getAttribute("width")).toBe("20");
  });

  it("supports undo and redo from the keyboard", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(screen.getByRole("button", { name: /^gate$/i }));
    await user.click(screen.getByTestId("grid-cell-0-0"));
    expect(container.querySelectorAll('rect[data-kind="gate-rect"]')).toHaveLength(1);

    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(container.querySelectorAll('rect[data-kind="gate-rect"]')).toHaveLength(0);

    fireEvent.keyDown(window, { key: "Z", ctrlKey: true, shiftKey: true });
    expect(container.querySelectorAll('rect[data-kind="gate-rect"]')).toHaveLength(1);
  });

  it("selects all circuit objects with ctrl+a outside text inputs", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(screen.getByRole("button", { name: /^gate$/i }));
    await user.click(screen.getByTestId("grid-cell-0-0"));
    await user.click(screen.getByRole("button", { name: /^control dot$/i }));
    await user.click(screen.getByTestId("grid-cell-1-1"));

    fireEvent.keyDown(window, { key: "a", ctrlKey: true });
    fireEvent.keyDown(window, { key: "Delete" });

    expect(container.querySelector('rect[data-kind="gate-rect"]')).toBeNull();
    expect(container.querySelector(".control-dot")).toBeNull();
  });
});
