import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@vercel/blob", () => ({
  get: vi.fn(),
  put: vi.fn()
}));

import { get, put } from "@vercel/blob";

const originalBlobToken = process.env.BLOB_READ_WRITE_TOKEN;
const originalVercel = process.env.VERCEL;

describe("sharePreviews", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.BLOB_READ_WRITE_TOKEN = undefined;
    process.env.VERCEL = undefined;
  });

  afterAll(() => {
    process.env.BLOB_READ_WRITE_TOKEN = originalBlobToken;
    process.env.VERCEL = originalVercel;
  });

  it("stores preview images in private Blob storage when token is configured", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "token";
    const putMock = vi.mocked(put);
    putMock.mockResolvedValue({} as never);

    const { storeSharePreviewImage } = await import("../src/server/sharePreviews");
    const imageId = await storeSharePreviewImage("data:image/png;base64,QUJD");

    expect(imageId).toMatch(/\.png$/);
    expect(putMock).toHaveBeenCalledTimes(1);
    expect(putMock).toHaveBeenCalledWith(
      expect.stringMatching(/^share-previews\/.+\.png$/),
      expect.any(Buffer),
      {
        access: "private",
        addRandomSuffix: false,
        contentType: "image/png"
      }
    );
  });

  it("reads preview images from private Blob storage when token is configured", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "token";
    const getMock = vi.mocked(get);
    getMock.mockResolvedValue({
      statusCode: 200,
      stream: new Response("png-bytes").body
    } as never);

    const { readSharePreviewImage } = await import("../src/server/sharePreviews");
    const image = await readSharePreviewImage("preview-1.png");

    expect(getMock).toHaveBeenCalledWith("share-previews/preview-1.png", { access: "private" });
    expect(image).toEqual(Buffer.from("png-bytes"));
  });
});
