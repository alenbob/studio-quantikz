import { afterAll, beforeEach, describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";

const originalPreviewDir = process.env.SHARE_PREVIEWS_DIR;
const originalDatabaseUrl = process.env.DATABASE_URL;

let previewDir = "";

describe("sharePreviews", () => {
  beforeEach(async () => {
    previewDir = await mkdtemp(path.join(os.tmpdir(), "quantikzz-share-previews-"));
    process.env.SHARE_PREVIEWS_DIR = previewDir;
    process.env.DATABASE_URL = undefined;
  });

  afterAll(async () => {
    if (previewDir) {
      await rm(previewDir, { recursive: true, force: true });
    }
    process.env.SHARE_PREVIEWS_DIR = originalPreviewDir;
    process.env.DATABASE_URL = originalDatabaseUrl;
  });

  it("stores preview images on the local filesystem when no database is configured", async () => {
    const { storeSharePreviewImage } = await import("../src/server/sharePreviews");
    const imageId = await storeSharePreviewImage("data:image/png;base64,QUJD");

    expect(imageId).toMatch(/\.png$/);
    const { readSharePreviewImage } = await import("../src/server/sharePreviews");
    const bytes = await readSharePreviewImage(imageId);
    expect(bytes).toEqual(Buffer.from("ABC"));
  });

  it("returns null for missing preview images on the local filesystem", async () => {
    const { readSharePreviewImage } = await import("../src/server/sharePreviews");
    await expect(readSharePreviewImage("preview-1.png")).resolves.toBeNull();
  });
});
