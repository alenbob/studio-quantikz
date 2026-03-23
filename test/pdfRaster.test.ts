import { describe, expect, it } from "vitest";
import { getPreviewRenderScale } from "../src/renderer/pdfRaster";

describe("pdf preview raster scale", () => {
  it("keeps the default scale for ordinary page sizes", () => {
    expect(getPreviewRenderScale(600, 200)).toBe(6);
  });

  it("scales down wide pages to stay within the canvas width limit", () => {
    expect(getPreviewRenderScale(2000, 400)).toBeCloseTo(4.096, 3);
  });

  it("scales down huge pages to stay within the canvas pixel budget", () => {
    expect(getPreviewRenderScale(5000, 5000)).toBeCloseTo(1.159, 2);
  });
});