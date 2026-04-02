import { storeShareCode } from "../src/server/shareCodeStore.js";

function readQueryString(value: unknown): string {
  return Array.isArray(value) ? String(value[0] ?? "") : String(value ?? "");
}

function jsonResponse(response: any, statusCode: number, payload: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(payload));
}

/**
 * Stores circuit code/preamble server-side and returns a short ID
 * POST /api/store-share-code
 * Body: { code: string, preamble: string }
 * Response: { success: true, id: string } or { success: false, error: string }
 */
export default async function handler(request: any, response: any): Promise<void> {
  if (request.method !== "POST") {
    jsonResponse(response, 405, { success: false, error: "Method not allowed." });
    return;
  }

  try {
    let code = "";
    let preamble = "";
    let previewImageId = "";

    // Parse JSON body
    if (request.headers["content-type"]?.includes("application/json")) {
      const rawBody = await new Promise<string>((resolve, reject) => {
        let data = "";
        request.on("data", (chunk: Buffer) => {
          data += chunk.toString();
        });
        request.on("end", () => resolve(data));
        request.on("error", reject);
      });

      try {
        const parsed = JSON.parse(rawBody || "{}");
        code = typeof parsed.code === "string" ? parsed.code : "";
        preamble = typeof parsed.preamble === "string" ? parsed.preamble : "";
        previewImageId = typeof parsed.previewImageId === "string" ? parsed.previewImageId.trim() : "";
      } catch (e) {
        // Invalid JSON
      }
    }

    if (!code.trim()) {
      jsonResponse(response, 400, { success: false, error: "Code is required." });
      return;
    }

    const id = await storeShareCode(code, preamble, previewImageId);

    jsonResponse(response, 200, { success: true, id });
  } catch (error) {
    console.error("Store share code error:", error);
    jsonResponse(response, 500, { success: false, error: "Failed to store share code." });
  }
}
