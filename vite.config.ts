import type { IncomingMessage, ServerResponse } from "node:http";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { listBugReports, readBugReportPreviewImage, validateBugReportAdminToken } from "./src/server/bugReports";
import { renderQuantikzPdf, renderQuantikzSvg } from "./src/server/renderQuantikz";
import { renderSymbolicLatex } from "./src/server/renderSymbolicLatex";

async function readJsonBody(request: IncomingMessage): Promise<{ code?: string; preamble?: string; envIndex?: number }> {
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

function parseBugReportLimit(urlValue: string | undefined): number {
  if (!urlValue) {
    return 50;
  }

  const parsed = Number.parseInt(urlValue, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("The bug report limit must be a positive integer.");
  }

  return Math.min(parsed, 200);
}

function readBugReportAdminToken(headers: IncomingMessage["headers"]): string | null {
  const authorization = headers.authorization;
  if (typeof authorization === "string" && authorization.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length).trim();
  }

  const directHeader = headers["x-bug-report-admin-token"];
  return typeof directHeader === "string" ? directHeader.trim() : null;
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
              sendJson(response, result.statusCode ?? 400, {
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

        server.middlewares.use("/api/symbolic-latex", async (request, response, next) => {
          if (request.method !== "POST") {
            next();
            return;
          }

          try {
            const body = await readJsonBody(request);
            const result = await renderSymbolicLatex(
              body.code ?? "",
              typeof body.envIndex === "number" ? body.envIndex : 0
            );
            sendJson(response, result.success ? 200 : (result.statusCode ?? 400), result);
          } catch (error) {
            sendJson(response, 500, {
              success: false,
              error: error instanceof Error ? error.message : "Unable to generate symbolic LaTeX."
            });
          }
        });

        server.middlewares.use("/api/symbolic-latex-dev", async (request, response, next) => {
          if (request.method !== "POST") {
            next();
            return;
          }

          try {
            const body = await readJsonBody(request);
            const result = await renderSymbolicLatex(
              body.code ?? "",
              typeof body.envIndex === "number" ? body.envIndex : 0
            );
            sendJson(response, result.success ? 200 : (result.statusCode ?? 400), result);
          } catch (error) {
            sendJson(response, 500, {
              success: false,
              error: error instanceof Error ? error.message : "Unable to generate symbolic LaTeX."
            });
          }
        });

        server.middlewares.use("/api/bug-reports", async (request, response, next) => {
          if (request.method !== "GET") {
            next();
            return;
          }

          try {
            const requestUrl = new URL(request.url ?? "/api/bug-reports", "http://localhost");
            validateBugReportAdminToken(readBugReportAdminToken(request.headers));
            const storageKey = requestUrl.searchParams.get("storageKey") ?? undefined;
            if (storageKey) {
              const image = await readBugReportPreviewImage(storageKey);
              if (!image) {
                response.statusCode = 404;
                response.end("Not found.");
                return;
              }

              response.statusCode = 200;
              response.setHeader("Content-Type", image.contentType);
              response.setHeader("Cache-Control", "private, max-age=60");
              response.end(image.body);
              return;
            }

            const reports = await listBugReports(parseBugReportLimit(requestUrl.searchParams.get("limit") ?? undefined));
            sendJson(response, 200, {
              success: true,
              reports
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : "Unable to list bug reports.";
            const statusCode = message === "Invalid bug report admin token."
              ? 401
              : /positive integer|required|configured/i.test(message)
                ? 400
                : 500;
            sendJson(response, statusCode, {
              success: false,
              error: message
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
