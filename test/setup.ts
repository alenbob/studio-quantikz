import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

afterEach(() => {
  cleanup();
});

Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
  configurable: true,
  value: vi.fn(() => ({
    font: "",
    measureText: (text: string) => ({ width: text.length * 9 })
  }))
});

if (!window.quantikzDesktop) {
  window.quantikzDesktop = {
    copyText: async () => true,
    exportQuantikzSvg: async () => ({ success: true, filePath: "/tmp/quantikz-circuit.svg" })
  };
}
