import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import App from "../src/renderer/App";
import { DEFAULT_CIRCUIT_LAYOUT, getCellCenterX, getGridHeight, getGridWidth, getRowY } from "../src/renderer/layout";

describe("App smoke tests", () => {
  it("places a gate onto the snapped grid and exports it", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(screen.getByRole("button", { name: /gate/i }));
    await user.click(screen.getByTestId("grid-cell-0-0"));
    await user.click(screen.getByRole("button", { name: /convert to quantikz/i }));

    const gateRect = container.querySelector('rect[data-kind="gate-rect"]') as SVGRectElement;
    expect(gateRect.getAttribute("rx")).toBe("0");
    expect((screen.getByLabelText(/quantikz output/i) as HTMLTextAreaElement).value).toContain(
      "\\gate{U}"
    );
  });

  it("resizes a gate when its label changes and exports a multi-row span", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(screen.getByRole("button", { name: /gate/i }));
    await user.click(screen.getByTestId("grid-cell-0-0"));

    const gateRect = container.querySelector('rect[data-kind="gate-rect"]') as SVGRectElement;
    const initialWidth = Number(gateRect.getAttribute("width"));

    await user.clear(screen.getByLabelText(/gate label/i));
    await user.type(screen.getByLabelText(/gate label/i), "LongerLabel");

    const widenedRect = container.querySelector('rect[data-kind="gate-rect"]') as SVGRectElement;
    expect(Number(widenedRect.getAttribute("width"))).toBeGreaterThan(initialWidth);

    fireEvent.change(screen.getByLabelText(/gate row span/i), { target: { value: "2" } });
    await user.click(screen.getByRole("button", { name: /convert to quantikz/i }));

    expect((screen.getByLabelText(/quantikz output/i) as HTMLTextAreaElement).value).toContain(
      "\\gate[wires=2]{LongerLabel}"
    );
  });

  it("places a meter onto the snapped grid and exports it", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(screen.getByRole("button", { name: /meter/i }));
    await user.click(screen.getByTestId("grid-cell-1-1"));
    await user.click(screen.getByRole("button", { name: /convert to quantikz/i }));

    expect(container.querySelector('rect[data-kind="meter-rect"]')).toBeTruthy();
    expect((screen.getByLabelText(/quantikz output/i) as HTMLTextAreaElement).value).toContain(
      "\\meter{}"
    );
  });

  it("copies generated code through the desktop bridge", async () => {
    const user = userEvent.setup();
    const copySpy = vi.fn(async () => true);
    window.quantikzDesktop = {
      copyText: copySpy,
      exportQuantikzSvg: async () => ({ success: true, filePath: "/tmp/test.svg" })
    };

    render(<App />);

    await user.click(screen.getByRole("button", { name: /gate/i }));
    await user.click(screen.getByTestId("grid-cell-0-0"));
    await user.click(screen.getByRole("button", { name: /convert to quantikz/i }));
    await user.click(screen.getByRole("button", { name: /copy code/i }));

    expect(copySpy).toHaveBeenCalledOnce();
    expect(copySpy.mock.calls[0][0]).toContain("\\begin{quantikz}");
  });

  it("resets the editor and exports wire labels", async () => {
    const user = userEvent.setup();
    render(<App />);

    fireEvent.change(screen.getByLabelText(/left label q1/i), { target: { value: "\\ket{0}" } });
    await user.click(screen.getByRole("button", { name: /gate/i }));
    await user.click(screen.getByTestId("grid-cell-0-0"));
    await user.click(screen.getByRole("button", { name: /convert to quantikz/i }));

    expect((screen.getByLabelText(/quantikz output/i) as HTMLTextAreaElement).value).toContain(
      "\\lstick{$\\ket{0}$}"
    );

    await user.click(screen.getByRole("button", { name: /^reset$/i }));

    expect((screen.getByLabelText(/quantikz output/i) as HTMLTextAreaElement).value).toBe("");
    expect(screen.getByLabelText(/left label q1/i)).toHaveValue("");
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

    expect((screen.getByLabelText(/quantikz output/i) as HTMLTextAreaElement).value).toContain(
      "\\lstick{$\\ket{c}_C$}"
    );
  });

  it("replaces the left palette with object controls while an item is selected", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /gate/i }));
    await user.click(screen.getByTestId("grid-cell-0-0"));

    expect(screen.getByText(/object controls/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/gate label/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^gate$/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /back to tools/i }));

    expect(screen.getByRole("button", { name: /^gate$/i })).toBeInTheDocument();
  });

  it("renders gate bodies above wire segments in the workspace SVG", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(screen.getByRole("button", { name: /gate/i }));
    await user.click(screen.getByTestId("grid-cell-0-0"));
    await user.click(screen.getByRole("button", { name: /back to tools/i }));
    await user.click(screen.getByRole("button", { name: /^Horizontal line$/i }));
    await user.click(screen.getByTestId("segment-slot-0-0"));
    fireEvent.change(screen.getByLabelText(/segment mode/i), { target: { value: "present" } });

    const gateRect = container.querySelector('rect[data-kind="gate-rect"]') as SVGRectElement;
    const wireSegment = container.querySelector(".present-override") as SVGLineElement;

    expect(wireSegment).toBeTruthy();
    expect(
      wireSegment.compareDocumentPosition(gateRect) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
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

    expect(screen.getByLabelText(/qubits/i)).toHaveValue("2");
    expect(screen.getByLabelText(/steps/i)).toHaveValue("2");
    expect(screen.getByLabelText(/left label q1/i)).toHaveValue("\\ket{0}");
    expect(screen.getByLabelText(/left label q2/i)).toHaveValue("\\ket{\\psi}");
    expect(screen.getByLabelText(/row spacing/i)).toHaveValue("1.1");
    expect(screen.getByLabelText(/column spacing/i)).toHaveValue("0.8");
  });

  it("pastes a copied selection back into the circuit", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(screen.getByRole("button", { name: /gate/i }));
    await user.click(screen.getByTestId("grid-cell-0-0"));
    await user.click(screen.getByRole("button", { name: /copy selected/i }));
    await user.click(screen.getByRole("button", { name: /^paste$/i }));

    const existingGate = container.querySelector('rect[data-kind="gate-rect"]') as SVGRectElement;
    fireEvent.pointerDown(existingGate, { button: 0 });

    expect(container.querySelectorAll('rect[data-kind="gate-rect"]')).toHaveLength(2);
  });

  it("pastes onto an empty area of the workspace when clicking the board", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    const board = container.querySelector(".workspace-board") as HTMLDivElement;
    const workbench = screen.getByLabelText(/circuit workbench/i);
    const width = getGridWidth(5, DEFAULT_CIRCUIT_LAYOUT);
    const height = getGridHeight(3, DEFAULT_CIRCUIT_LAYOUT);

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

    await user.click(screen.getByRole("button", { name: /gate/i }));
    await user.click(screen.getByTestId("grid-cell-0-0"));
    await user.click(screen.getByRole("button", { name: /copy selected/i }));
    await user.click(screen.getByRole("button", { name: /^paste$/i }));

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

  it("turns deleted unlocked horizontal lines into wire overrides", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(screen.getByRole("button", { name: /unlock horizontal lines/i }));
    await user.click(screen.getByRole("button", { name: /select\/move/i }));
    await user.click(screen.getByTestId("segment-slot-0-0"));

    const horizontalLine = container.querySelector(".present-override") as SVGLineElement;
    expect(horizontalLine).toBeTruthy();
    expect(screen.getByLabelText(/segment mode/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /copy selected/i })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: /delete selected/i }));
    await user.click(screen.getByRole("button", { name: /convert to quantikz/i }));

    expect(container.querySelector(".absent-override")).toBeTruthy();
    expect((screen.getByLabelText(/quantikz output/i) as HTMLTextAreaElement).value).toContain(
      "\\wireoverride{n}"
    );
  });
});
