import { beforeEach, describe, expect, it, vi } from "vitest";

const { readSharePreviewImageMock, storeSharePreviewImageMock } = vi.hoisted(() => ({
  readSharePreviewImageMock: vi.fn(),
  storeSharePreviewImageMock: vi.fn()
}));

vi.mock("../src/server/sharePreviews.js", () => ({
  readSharePreviewImage: readSharePreviewImageMock,
  storeSharePreviewImage: storeSharePreviewImageMock
}));

import handler from "../api/share-preview-image";

describe("share-preview-image api", () => {
  beforeEach(() => {
    readSharePreviewImageMock.mockReset();
    storeSharePreviewImageMock.mockReset();
  });

  it("stores an uploaded preview image", async () => {
    storeSharePreviewImageMock.mockResolvedValue("preview-1.png");

    const request = {
      method: "POST",
      body: JSON.stringify({ imageDataUrl: "data:image/png;base64,QUJD" }),
      on: () => request
    };

    const responseState: { statusCode?: number; payload?: unknown } = {};
    const response = {
      status(code: number) {
        responseState.statusCode = code;
        return this;
      },
      json(payload: unknown) {
        responseState.payload = payload;
        return this;
      }
    };

    await handler(request, response);

    expect(storeSharePreviewImageMock).toHaveBeenCalledWith("data:image/png;base64,QUJD");
    expect(responseState.statusCode).toBe(200);
    expect(responseState.payload).toEqual({ success: true, imageId: "preview-1.png" });
  });

  it("returns a stored preview image", async () => {
    const image = Buffer.from("png-bytes", "utf8");
    readSharePreviewImageMock.mockResolvedValue(image);

    const request = {
      method: "GET",
      query: { id: "preview-1.png" }
    };

    const responseState: {
      statusCode?: number;
      headers: Record<string, string>;
      payload?: unknown;
    } = { headers: {} };

    const response = {
      setHeader(name: string, value: string) {
        responseState.headers[name] = value;
        return this;
      },
      status(code: number) {
        responseState.statusCode = code;
        return this;
      },
      json(payload: unknown) {
        responseState.payload = payload;
        return this;
      },
      send(payload: unknown) {
        responseState.payload = payload;
        return this;
      }
    };

    await handler(request, response);

    expect(readSharePreviewImageMock).toHaveBeenCalledWith("preview-1.png");
    expect(responseState.statusCode).toBe(200);
    expect(responseState.headers["Content-Type"]).toBe("image/png");
    expect(responseState.payload).toBe(image);
  });
});