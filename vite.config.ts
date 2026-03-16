import type { IncomingMessage, ServerResponse } from "node:http";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { renderQuantikzPdf, renderQuantikzSvg } from "./src/server/renderQuantikz";

async function readJsonBody(request: IncomingMessage): Promise<{ code?: string; preamble?: string }> {
  return new Promise((resolve, reject) => {
    let data = "";

    request.on("data", (chunk) => {
      data += chunk.toString();
    });

    request.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (error) {
        reject(error);
      }
    });

    request.on("error", reject);
  });
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(payload));
}

function sendPdf(response: ServerResponse, pdf: Buffer): void {
  response.statusCode = 200;
  response.setHeader("Content-Type", "application/pdf");
  response.setHeader("Content-Disposition", "attachment; filename=\"quantikz-circuit.pdf\"");
  response.end(pdf);
}

export default defineConfig({
  plugins: [
    react(),
    {
      name: "quantikzz-render-api",
      configureServer(server) {
        server.middlewares.use("/api/render-svg", async (request, response, next) => {
          if (request.method !== "POST") {
            next();
            return;
          }

          try {
            const body = await readJsonBody(request);
            const result = await renderQuantikzSvg(body.code ?? "", body.preamble ?? "");
            sendJson(response, result.success ? 200 : (result.statusCode ?? 400), result);
          } catch (error) {
            sendJson(response, 500, {
              success: false,
              error: error instanceof Error ? error.message : "Unable to render SVG."
            });
          }
        });

        server.middlewares.use("/api/render-pdf", async (request, response, next) => {
          if (request.method !== "POST") {
            next();
            return;
          }

          try {
            const body = await readJsonBody(request);
            const result = await renderQuantikzPdf(body.code ?? "", body.preamble ?? "");
            if (!result.success || !result.pdf) {
              sendJson(response, 400, {
                success: false,
                error: result.error ?? "Unable to render PDF."
              });
              return;
            }

            sendPdf(response, result.pdf);
          } catch (error) {
            sendJson(response, 500, {
              success: false,
              error: error instanceof Error ? error.message : "Unable to render PDF."
            });
          }
        });
      }
    }
  ],
  build: {
    outDir: "dist",
    emptyOutDir: true
  }
});
