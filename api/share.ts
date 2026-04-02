const SHARE_CODE_SEARCH_PARAM = "q";
const SHARE_PREAMBLE_SEARCH_PARAM = "qp";
const SHARE_PREVIEW_IMAGE_ID_SEARCH_PARAM = "img";

function buildSharedCircuitUrl(origin: string, code: string, preamble: string): string {
  const appUrl = new URL("/", origin);
  const trimmedCode = code.trim();

  if (!trimmedCode) {
    return appUrl.toString();
  }

  appUrl.searchParams.set(SHARE_CODE_SEARCH_PARAM, code);
  if (preamble.trim()) {
    appUrl.searchParams.set(SHARE_PREAMBLE_SEARCH_PARAM, preamble);
  }

  return appUrl.toString();
}

function readQueryString(value: unknown): string {
  return Array.isArray(value) ? String(value[0] ?? "") : String(value ?? "");
}

function htmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function resolveOrigin(request: any): string {
  const forwardedProto = readQueryString(request.headers?.["x-forwarded-proto"]) || "https";
  const forwardedHost = readQueryString(request.headers?.["x-forwarded-host"]);
  const host = forwardedHost || readQueryString(request.headers?.host) || "localhost:3000";
  return `${forwardedProto}://${host}`;
}

export default async function handler(request: any, response: any): Promise<void> {
  if (request.method !== "GET") {
    response.status(405).send("Method not allowed.");
    return;
  }

  const code = readQueryString(request.query?.[SHARE_CODE_SEARCH_PARAM]);
  const preamble = readQueryString(request.query?.[SHARE_PREAMBLE_SEARCH_PARAM]);
  const imageId = readQueryString(request.query?.[SHARE_PREVIEW_IMAGE_ID_SEARCH_PARAM]);

  const origin = resolveOrigin(request);
  const appUrl = buildSharedCircuitUrl(origin, code, preamble);
  // imageId is either a full Vercel Blob CDN URL (production) or a filename (local dev).
  const imageUrl = imageId
    ? (imageId.startsWith("https://") ? imageId : `${origin}/api/share-preview-image?id=${encodeURIComponent(imageId)}`)
    : "";

  const description = "Open this shared Quantikz circuit in Studio Quantikz.";
  const escapedTitle = htmlEscape("Shared Quantikz circuit");
  const escapedDescription = htmlEscape(description);
  const escapedAppUrl = htmlEscape(appUrl);
  const escapedImageUrl = imageUrl ? htmlEscape(imageUrl) : "";
  const imageMeta = escapedImageUrl
    ? `\n    <meta property="og:image" content="${escapedImageUrl}" />\n    <meta name="twitter:card" content="summary_large_image" />\n    <meta name="twitter:image" content="${escapedImageUrl}" />`
    : "\n    <meta name=\"twitter:card\" content=\"summary\" />";

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapedTitle}</title>
    <meta name="description" content="${escapedDescription}" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="${escapedTitle}" />
    <meta property="og:description" content="${escapedDescription}" />
    <meta property="og:url" content="${escapedAppUrl}" />
  ${imageMeta}
    <meta name="twitter:title" content="${escapedTitle}" />
    <meta name="twitter:description" content="${escapedDescription}" />
    <meta http-equiv="refresh" content="0;url=${escapedAppUrl}" />
    <script>window.location.replace(${JSON.stringify(appUrl)});</script>
  </head>
  <body>
    <p>Opening shared circuit...</p>
    <p><a href="${escapedAppUrl}">Continue to Studio Quantikz</a></p>
  </body>
</html>`;

  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.status(200).send(html);
}