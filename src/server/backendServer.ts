import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import bugReportHandler from "../../api/bug-report.js";
import bugReportsHandler from "../../api/bug-reports.js";
import renderPdfHandler from "../../api/render-pdf.js";
import renderSvgHandler from "../../api/render-svg.js";
import shareHandler from "../../api/share.js";
import sharePreviewImageHandler from "../../api/share-preview-image.js";
import storeShareCodeHandler from "../../api/store-share-code.js";
import symbolicLatexHandler from "../../api/symbolic-latex.js";
import symbolicLatexDevHandler from "../../api/symbolic-latex-dev.js";

type RouteHandler = (request: any, response: any) => Promise<void>;

const PORT = Number.parseInt(process.env.PORT || "10000", 10);

const routeHandlers = new Map<string, RouteHandler>([
  ["/api/bug-report", bugReportHandler],
  ["/api/bug-reports", bugReportsHandler],
  ["/api/render-pdf", renderPdfHandler],
  ["/api/render-svg", renderSvgHandler],
  ["/api/share", shareHandler],
  ["/api/share-preview-image", sharePreviewImageHandler],
  ["/api/store-share-code", storeShareCodeHandler],
  ["/api/symbolic-latex", symbolicLatexHandler],
  ["/api/symbolic-latex-dev", symbolicLatexDevHandler],
]);

function buildQueryObject(url: URL): Record<string, string | string[]> {
  const query: Record<string, string | string[]> = {};
  for (const [key, value] of url.searchParams.entries()) {
    const current = query[key];
    if (current === undefined) {
      query[key] = value;
      continue;
    }

    query[key] = Array.isArray(current) ? [...current, value] : [current, value];
  }

  return query;
}

function wrapResponse(response: ServerResponse) {
  const wrapped = response as ServerResponse & {
    status: (code: number) => typeof wrapped;
    json: (payload: unknown) => typeof wrapped;
    send: (payload: unknown) => typeof wrapped;
  };

  wrapped.status = (code: number) => {
    response.statusCode = code;
    return wrapped;
  };

  wrapped.json = (payload: unknown) => {
    if (!response.hasHeader("Content-Type")) {
      response.setHeader("Content-Type", "application/json");
    }
    response.end(JSON.stringify(payload));
    return wrapped;
  };

  wrapped.send = (payload: unknown) => {
    if (Buffer.isBuffer(payload) || typeof payload === "string") {
      response.end(payload);
      return wrapped;
    }

    if (!response.hasHeader("Content-Type")) {
      response.setHeader("Content-Type", "application/json");
    }
    response.end(JSON.stringify(payload));
    return wrapped;
  };

  return wrapped;
}

const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
  const requestUrl = new URL(request.url || "/", "http://127.0.0.1");

  if (requestUrl.pathname === "/health") {
    response.statusCode = 200;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ ok: true }));
    return;
  }

  const handler = routeHandlers.get(requestUrl.pathname);
  if (!handler) {
    response.statusCode = 404;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ success: false, error: "Not found." }));
    return;
  }

  try {
    Object.assign(request, { query: buildQueryObject(requestUrl) });
    await handler(request, wrapResponse(response));
  } catch (error) {
    response.statusCode = 500;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : "Server error."
    }));
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Backend server listening on http://0.0.0.0:${PORT}`);
});