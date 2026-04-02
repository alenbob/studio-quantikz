import { logTinyShareUsage } from "../src/server/shareUsage.js";

const SHARE_CODE_SEARCH_PARAM = "q";
const SHARE_CODE_ID_SEARCH_PARAM = "s";
const SHARE_PREAMBLE_SEARCH_PARAM = "qp";
const SHARE_PREVIEW_IMAGE_ID_SEARCH_PARAM = "img";

const BASE62_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

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
    // Dynamic import for Node.js
    const pako = (await import("pako")).default;
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

  const compressedPayload = readQueryString(request.query?.[SHARE_CODE_SEARCH_PARAM]);
  const shortId = readQueryString(request.query?.[SHARE_CODE_ID_SEARCH_PARAM]);
  const imageIdFromQuery = readQueryString(request.query?.[SHARE_PREVIEW_IMAGE_ID_SEARCH_PARAM]);

  let code = "";
  let preamble = "";
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
  if (!code && compressedPayload) {
    const payload = await decompressPayload(compressedPayload);
    if (payload) {
      code = payload.code ?? "";
      preamble = payload.preamble ?? "";
    }
  }

  const origin = resolveOrigin(request);
  const appUrl = buildSharedCircuitUrl(origin, code, preamble);
  const imageId = imageIdFromQuery || imageIdFromStore;
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