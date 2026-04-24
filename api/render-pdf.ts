import { handleCors } from "./_cors.js";
import { renderQuantikzPdf } from "../src/server/renderQuantikz.js";

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

export default async function handler(request: any, response: any): Promise<void> {
  if (handleCors(request, response)) {
    return;
  }

  if (request.method !== "POST") {
    response.status(405).json({ success: false, error: "Method not allowed." });
    return;
  }

  try {
    const rawBody = await readRequestBody(request);
    const parsed = rawBody ? JSON.parse(rawBody) : {};
    const code = typeof parsed.code === "string" ? parsed.code : "";
    const preamble = typeof parsed.preamble === "string" ? parsed.preamble : "";
    const result = await renderQuantikzPdf(code, preamble);

    if (!result.success || !result.pdf) {
      response.status(result.statusCode ?? 400).json({
        success: false,
        error: result.error ?? "Unable to render PDF."
      });
      return;
    }

    response.setHeader("Content-Type", "application/pdf");
    response.setHeader("Content-Disposition", "attachment; filename=\"quantikz-circuit.pdf\"");
    response.status(200).send(result.pdf);
  } catch (error) {
    response.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unable to render PDF."
    });
  }
}
