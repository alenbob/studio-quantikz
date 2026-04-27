import { logTinyShareUsage } from "../src/server/shareUsage.js";

import { handleCors } from "./_cors.js";

const SHARE_CODE_SEARCH_PARAM = "q";
const SHARE_CODE_ID_SEARCH_PARAM = "s";
const SHARE_PREVIEW_IMAGE_ID_SEARCH_PARAM = "img";
const PUBLIC_APP_URL_ENV = "PUBLIC_APP_URL";

const BASE62_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

async function loadPako() {
  return (await import("pako")).default;
}

function encodeToBase62(data: Uint8Array): string {
  let num = 0n;
  for (let i = 0; i < data.length; i++) {
    num = (num << 8n) | BigInt(data[i]);
  }

  if (num === 0n) return "0";

  let result = "";
  while (num > 0n) {
    result = BASE62_ALPHABET[Number(num % 62n)] + result;
    num = num / 62n;
  }

  return result;
}

function decodeFromBase62(str: string): Uint8Array {
  let num = 0n;
  for (let i = 0; i < str.length; i++) {
    const digit = BASE62_ALPHABET.indexOf(str[i]);
    if (digit === -1) throw new Error(`Invalid Base62 character: ${str[i]}`);
    num = num * 62n + BigInt(digit);
  }

  const bytes: number[] = [];
  while (num > 0n) {
    bytes.unshift(Number(num & 0xffn));
    num = num >> 8n;
  }

  return new Uint8Array(bytes);
}

async function decompressPayload(compressed: string): Promise<{ code?: string; preamble?: string } | null> {
  try {
    const pako = await loadPako();
    const decoded = decodeFromBase62(compressed);
    const decompressed = pako.inflate(decoded, { to: "string" });
    const payload = JSON.parse(decompressed);
    
    if (!Array.isArray(payload) || !payload[0]) {
      return null;
    }

    return {
      code: payload[0],
      preamble: payload[1] || ""
    };
  } catch {
    return null;
  }
}

async function compressPayload(code: string, preamble: string): Promise<string> {
  const pako = await loadPako();
  const payload = preamble ? [code, preamble] : [code];
  const json = JSON.stringify(payload);
  return encodeToBase62(pako.deflate(json));
}

function normalizeBaseUrl(value: string): string {
  const parsed = new URL(value);
  parsed.search = "";
  parsed.hash = "";
  if (!parsed.pathname.endsWith("/")) {
    parsed.pathname = `${parsed.pathname}/`;
  }
  return parsed.toString();
}

function resolveAppBaseUrl(request: any): string {
  const configured = process.env[PUBLIC_APP_URL_ENV]?.trim();
  if (configured) {
    return normalizeBaseUrl(configured);
  }

  return normalizeBaseUrl(resolveOrigin(request));
}

function buildSharedCircuitUrl(appBaseUrl: string, compressedPayload: string): string {
  const appUrl = new URL(appBaseUrl);
  if (compressedPayload.trim()) {
    appUrl.searchParams.set(SHARE_CODE_SEARCH_PARAM, compressedPayload);
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
  if (handleCors(request, response)) {
    return;
  }

  if (request.method !== "GET") {
    response.status(405).send("Method not allowed.");
    return;
  }

  const compressedPayloadFromQuery = readQueryString(request.query?.[SHARE_CODE_SEARCH_PARAM]);
  const shortId = readQueryString(request.query?.[SHARE_CODE_ID_SEARCH_PARAM]);
  const imageIdFromQuery = readQueryString(request.query?.[SHARE_PREVIEW_IMAGE_ID_SEARCH_PARAM]);

  let code = "";
  let preamble = "";
  let compressedPayload = "";
  let imageIdFromStore = "";
  let resolvedShortId = false;

  // Try short ID first (new format)
  if (shortId) {
    try {
      const { retrieveShareCode } = await import("../src/server/shareCodeStore.js");
      const stored = await retrieveShareCode(shortId);
      if (stored) {
        code = stored.code ?? "";
        preamble = stored.preamble ?? "";
        compressedPayload = await compressPayload(code, preamble);
        imageIdFromStore = stored.previewImageId ?? "";
        resolvedShortId = true;
      }
    } catch (error) {
      // Fall through to try compressed payload
    }

    // Logging is non-blocking for user flow. Failures should not break redirects.
    try {
      await logTinyShareUsage(shortId, resolvedShortId, request);
    } catch {
      // Ignore logging errors
    }
  }

  // Fall back to compressed payload (old format, for backward compatibility)
  if (!compressedPayload && compressedPayloadFromQuery) {
    const payload = await decompressPayload(compressedPayloadFromQuery);
    if (payload) {
      code = payload.code ?? "";
      preamble = payload.preamble ?? "";
      compressedPayload = compressedPayloadFromQuery;
    }
  }

  const origin = resolveOrigin(request);
  const appUrl = buildSharedCircuitUrl(resolveAppBaseUrl(request), compressedPayload);
  const imageId = imageIdFromQuery || imageIdFromStore;
  // imageId is either a full external image URL, a database-backed image id, or a local filename.
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