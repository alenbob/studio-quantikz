import { handleCors } from "./_cors.js";
import { readSharePreviewImage, storeSharePreviewImage } from "../src/server/sharePreviews.js";

async function readRequestBody(request: { body?: unknown; on: (event: string, cb: (chunk: Buffer | string) => void) => void }): Promise<string> {
  if (typeof request.body === "string") {
    return request.body;
  }

  if (request.body && typeof request.body === "object") {
    return JSON.stringify(request.body);
  }

  return new Promise((resolve, reject) => {
    let data = "";

    request.on("data", (chunk) => {
      data += chunk.toString();
    });

    request.on("end", () => resolve(data));
    request.on("error", reject);
  });
}

function readQueryString(value: unknown): string {
  return Array.isArray(value) ? String(value[0] ?? "") : String(value ?? "");
}

export default async function handler(request: any, response: any): Promise<void> {
  if (handleCors(request, response)) {
    return;
  }

  if (request.method === "GET") {
    try {
      const imageId = readQueryString(request.query?.id);
      if (!imageId) {
        response.status(400).json({ success: false, error: "Share preview image id is required." });
        return;
      }

      const image = await readSharePreviewImage(imageId);
      if (!image) {
        response.status(404).json({ success: false, error: "Share preview image not found." });
        return;
      }

      response.setHeader("Content-Type", "image/png");
      response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      response.status(200).send(image);
      return;
    } catch (error) {
      response.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Unable to read share preview image."
      });
      return;
    }
  }

  if (request.method === "POST") {
    try {
      const rawBody = await readRequestBody(request);
      const parsed = rawBody ? JSON.parse(rawBody) : {};
      const imageDataUrl = typeof parsed.imageDataUrl === "string" ? parsed.imageDataUrl : "";
      const imageId = await storeSharePreviewImage(imageDataUrl);

      response.status(200).json({
        success: true,
        imageId
      });
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to store share preview image.";
      const statusCode = /required|must be|empty|too large|invalid/i.test(message) ? 400 : 500;

      response.status(statusCode).json({
        success: false,
        error: message
      });
      return;
    }
  }

  response.status(405).json({ success: false, error: "Method not allowed." });
}