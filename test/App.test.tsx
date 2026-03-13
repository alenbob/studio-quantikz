import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import App from "../src/renderer/App";
import { DEFAULT_CIRCUIT_LAYOUT, getCellCenterX, getGridHeight, getGridWidth, getRowY } from "../src/renderer/layout";

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
    await user.click(screen.getByRole("button", { name: /select\/move/i }));

    const gateRect = container.querySelector('rect[data-kind="gate-rect"]') as SVGRectElement;
    fireEvent.pointerDown(gateRect, { button: 0 });

    expect(screen.getByText(/object controls/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/gate label/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^gate$/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /back to tools/i }));

    expect(screen.getByRole("button", { name: /^gate$/i })).toBeInTheDocument();
  });

  it("renders gate bodies above wire segments in the workspace SVG", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(screen.getByRole("button", { name: /^gate$/i }));
    await user.click(screen.getByTestId("grid-cell-0-0"));
    await user.click(screen.getByRole("button", { name: /^pencil$/i }));
    await user.click(screen.getByTestId("segment-slot-0-0"));

    const gateRect = container.querySelector('rect[data-kind="gate-rect"]') as SVGRectElement;
    const wireSegment = container.querySelector(".horizontal-segment") as SVGGElement;

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

  it("pastes a copied selection back into the circuit", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    const board = container.querySelector(".workspace-board") as HTMLDivElement;
    const workbench = screen.getByLabelText(/circuit workbench/i);
    mockBoardRect(board);

    await user.click(screen.getByRole("button", { name: /^gate$/i }));
    await user.click(screen.getByTestId("grid-cell-0-0"));
    await user.click(screen.getByRole("button", { name: /select\/move/i }));

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

    await user.click(screen.getByRole("button", { name: /select\/move/i }));

    const horizontalLine = container.querySelector(".horizontal-segment") as SVGGElement;
    fireEvent.pointerDown(horizontalLine, { button: 0 });

    expect(screen.getByLabelText(/segment mode/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /delete selected/i }));
    await user.click(screen.getByRole("button", { name: /convert to quantikz/i }));

    expect(container.querySelector(".absent-override")).toBeTruthy();
    expect(container.querySelector(".absent-override circle")).toBeNull();
    expect((screen.getByLabelText(/quantikz output/i) as HTMLTextAreaElement).value).toContain("\\wireoverride{n}");
  });

  it("lets a selected horizontal segment switch to classical wire style", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /select\/move/i }));
    const horizontalLine = document.querySelector(".horizontal-segment") as SVGGElement;
    fireEvent.pointerDown(horizontalLine, { button: 0 });

    fireEvent.change(screen.getByLabelText(/horizontal wire style/i), {
      target: { value: "classical" }
    });

    await user.click(screen.getByRole("button", { name: /convert to quantikz/i }));
    expect((screen.getByLabelText(/quantikz output/i) as HTMLTextAreaElement).value).toContain("\\wireoverride{c}");
  });

  it("can grow the grid without auto-wiring the new row and column", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(screen.getByRole("button", { name: /auto wires/i }));
    await user.click(screen.getByRole("button", { name: /increase qubits/i }));
    await user.click(screen.getByRole("button", { name: /increase steps/i }));

    expect(container.querySelectorAll(".absent-override").length).toBeGreaterThan(0);
  });

  it("shows row numbers on the far left of the circuit", () => {
    const { container } = render(<App />);
    expect(container.querySelectorAll(".grid-row-label")).toHaveLength(3);
  });

  it("lets a selected control switch to an open c0 control", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(screen.getByRole("button", { name: /^control dot$/i }));
    await user.click(screen.getByTestId("grid-cell-0-0"));
    await user.click(screen.getByRole("button", { name: /select\/move/i }));

    const controlDot = container.querySelector(".control-dot") as SVGCircleElement;
    fireEvent.pointerDown(controlDot, { button: 0 });

    fireEvent.change(screen.getByLabelText(/control type/i), {
      target: { value: "open" }
    });

    await user.click(screen.getByRole("button", { name: /convert to quantikz/i }));

    expect(container.querySelector(".control-dot-open")).toBeTruthy();
    expect((screen.getByLabelText(/quantikz output/i) as HTMLTextAreaElement).value).toContain("\\ocontrol{}");
  });

  it("paints multiple vertical connectors in one pencil stroke", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    const board = container.querySelector(".workspace-board") as HTMLDivElement;
    mockBoardRect(board);

    await user.click(screen.getByRole("button", { name: /^pencil$/i }));

    await user.pointer([{ target: screen.getByTestId("grid-cell-0-0"), keys: "[MouseLeft>]" }]);
    fireEvent.pointerEnter(screen.getByTestId("grid-cell-0-1"), {
      clientX: getCellCenterX(1, DEFAULT_CIRCUIT_LAYOUT),
      clientY: getRowY(0, DEFAULT_CIRCUIT_LAYOUT) + 18
    });
    fireEvent.pointerEnter(screen.getByTestId("grid-cell-0-2"), {
      clientX: getCellCenterX(2, DEFAULT_CIRCUIT_LAYOUT),
      clientY: getRowY(0, DEFAULT_CIRCUIT_LAYOUT) + 18
    });
    fireEvent.pointerUp(window);

    expect(container.querySelectorAll(".vertical-connector").length).toBeGreaterThanOrEqual(3);
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
});
