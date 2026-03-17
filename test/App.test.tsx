import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import App from "../src/renderer/App";
import { DEFAULT_CIRCUIT_LAYOUT, getCellCenterX, getGridHeight, getGridWidth, getRowY } from "../src/renderer/layout";
import * as renderedPdfModule from "../src/renderer/useRenderedPdf";

vi.mock("../src/renderer/pdfRaster", () => ({
  renderPdfBlobToPngBlob: vi.fn(async () => new Blob(["png-preview"], { type: "image/png" }))
}));

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

  it("resets the editor and exports wire labels", async () => {
    const user = userEvent.setup();
    render(<App />);

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
    expect(output).toContain("draw={rgb,255:red,255;green,0;blue,0}");
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
    await user.click(screen.getByRole("button", { name: /^preamble$/i }));

    expect((screen.getByLabelText(/quantikz preamble/i) as HTMLTextAreaElement).value).toContain(
      String.raw`\newcommand{\foo}{bar}`
    );
    await user.click(screen.getByRole("button", { name: /^code$/i }));
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
      previewImageUrl: code.includes(String.raw`\begin{quantikz}`)
        ? "blob:quantikz-preview-image"
        : null,
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

      expect(useRenderedPdfSpy).toHaveBeenLastCalledWith(
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
        delete (navigator as Navigator & { clipboard?: Navigator["clipboard"] }).clipboard;
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

  it("turns deleted horizontal lines into wire overrides", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(screen.getByRole("button", { name: /unlock wires/i }));
    await user.click(screen.getByRole("button", { name: /^select$/i }));
    await user.click(screen.getByTestId("segment-slot-0-1"));

    expect(screen.getByLabelText(/segment mode/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /delete selected/i }));
    await user.click(screen.getByRole("button", { name: /convert to quantikz/i }));

    expect(container.querySelector(".absent-override")).toBeNull();
    expect((screen.getByLabelText(/quantikz output/i) as HTMLTextAreaElement).value).toContain("\\wireoverride{n}");
  });

  it("lets a selected horizontal segment switch to classical wire style", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /unlock wires/i }));
    await user.click(screen.getByRole("button", { name: /^select$/i }));
    await user.click(screen.getByTestId("segment-slot-0-1"));

    fireEvent.change(screen.getByLabelText(/horizontal wire style/i), {
      target: { value: "classical" }
    });

    await user.click(screen.getByRole("button", { name: /convert to quantikz/i }));
    expect((screen.getByLabelText(/quantikz output/i) as HTMLTextAreaElement).value).toContain("\\wireoverride{c}");
  });

  it("does not select a horizontal segment while wires are locked", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /^select$/i }));
    await user.click(screen.getByTestId("segment-slot-0-1"));

    expect(screen.queryByLabelText(/segment mode/i)).toBeNull();
    expect(screen.queryByLabelText(/horizontal wire style/i)).toBeNull();
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
    expect(output).not.toContain("\\wireoverride{n}");
  });

  it("lets you redraw a wire to the right of a meter", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    const board = container.querySelector(".workspace-board") as HTMLDivElement;
    mockBoardRect(board);

    await user.click(screen.getByRole("button", { name: /^meter$/i }));
    await user.click(screen.getByTestId("grid-cell-0-0"));

    await user.click(screen.getByRole("button", { name: /^wires$/i }));
    fireEvent.pointerDown(board, {
      button: 0,
      clientX: getCellCenterX(0, DEFAULT_CIRCUIT_LAYOUT),
      clientY: getRowY(0, DEFAULT_CIRCUIT_LAYOUT)
    });
    fireEvent.pointerDown(board, {
      button: 0,
      clientX: getCellCenterX(1, DEFAULT_CIRCUIT_LAYOUT),
      clientY: getRowY(0, DEFAULT_CIRCUIT_LAYOUT)
    });
    await user.click(screen.getByRole("button", { name: /convert to quantikz/i }));

    const output = (screen.getByLabelText(/quantikz output/i) as HTMLTextAreaElement).value;

    expect(output).toContain("\\meter{}");
    expect(output).not.toContain("\\wireoverride{q}");
  });

  it("can grow the grid without auto-wiring the new row and column", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /auto wires/i }));
    await user.click(screen.getByRole("button", { name: /increase qubits/i }));
    await user.click(screen.getByRole("button", { name: /increase steps/i }));
    await user.click(screen.getByRole("button", { name: /convert to quantikz/i }));

    const output = (screen.getByLabelText(/quantikz output/i) as HTMLTextAreaElement).value;

    expect(output).toContain("\\wireoverride{n}");
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

    await user.click(screen.getByRole("button", { name: /^preamble$/i }));
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
    fireEvent.pointerDown(screen.getByTestId("grid-cell-0-0"), {
      button: 0,
      clientX: getCellCenterX(0, DEFAULT_CIRCUIT_LAYOUT),
      clientY: getRowY(0, DEFAULT_CIRCUIT_LAYOUT)
    });
    fireEvent.pointerDown(screen.getByTestId("grid-cell-2-0"), {
      button: 0,
      clientX: getCellCenterX(0, DEFAULT_CIRCUIT_LAYOUT),
      clientY: getRowY(2, DEFAULT_CIRCUIT_LAYOUT)
    });

    await waitFor(() => {
      expect(container.querySelectorAll(".vertical-connector")).toHaveLength(2);
    });
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
