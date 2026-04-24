import pako from "pako";
import { buildApiUrl } from "./api";
import { DEFAULT_EXPORT_PREAMBLE } from "./document";

export const SHARE_CODE_SEARCH_PARAM = "q";
export const SHARE_CODE_ID_SEARCH_PARAM = "s";
export const SHARE_PREAMBLE_SEARCH_PARAM = "qp";
export const SHARE_PREVIEW_IMAGE_ID_SEARCH_PARAM = "img";

export interface SharedCircuitPayload {
  code: string;
  preamble: string;
}

const BASE62_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

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

function compressPayload(code: string, preamble: string): string {
  // Use array format: [code, preamble] - shorter than object notation
  // Only include preamble if it's non-empty, using null as marker for default
  const payload = preamble ? [code, preamble] : [code];
  const jsonStr = JSON.stringify(payload);
  const compressed = pako.deflate(jsonStr);
  return encodeToBase62(compressed);
}

function decompressPayload(compressed: string): { code: string; preamble: string } | null {
  try {
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

export function readSharedCircuitFromSearch(
  locationSearch: string,
  fallbackPreamble = DEFAULT_EXPORT_PREAMBLE
): SharedCircuitPayload | null {
  const params = new URLSearchParams(locationSearch);
  
  // Try short ID first (new format - just a tiny string stored server-side)
  const shortId = params.get(SHARE_CODE_ID_SEARCH_PARAM);
  if (shortId) {
    // Don't decompress - the app will fetch from server when needed
    // For now, we return null and let the App component handle fetching
    return null;
  }

  // Fall back to compressed payload (old format)
  const compressed = params.get(SHARE_CODE_SEARCH_PARAM);
  if (!compressed) {
    return null;
  }

  const payload = decompressPayload(compressed);
  if (!payload) {
    return null;
  }

  return {
    code: payload.code,
    preamble: payload.preamble || fallbackPreamble
  };
}

export function buildSharedCircuitUrl(
  currentUrl: string,
  code: string,
  preamble: string,
  fallbackPreamble = DEFAULT_EXPORT_PREAMBLE
): string {
  const nextUrl = new URL(currentUrl);
  const trimmedCode = code.trim();

  if (!trimmedCode) {
    nextUrl.searchParams.delete(SHARE_CODE_SEARCH_PARAM);
    nextUrl.searchParams.delete(SHARE_PREAMBLE_SEARCH_PARAM);
    return nextUrl.toString();
  }

  const compressedPayload = compressPayload(code, preamble !== fallbackPreamble ? preamble : "");
  nextUrl.searchParams.set(SHARE_CODE_SEARCH_PARAM, compressedPayload);
  nextUrl.searchParams.delete(SHARE_PREAMBLE_SEARCH_PARAM);

  return nextUrl.toString();
}

export async function buildShareLandingUrlWithServerStorage(
  currentUrl: string,
  code: string,
  preamble: string,
  previewImageId?: string
): Promise<string> {
  const current = new URL(currentUrl);
  
  // Store code server-side and get short ID.
  // We no longer generate legacy long q= share links.
  const response = await fetch(buildApiUrl("/api/store-share-code"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code,
      preamble,
      previewImageId: previewImageId?.trim() || ""
    })
  });

  const data = await response.json();
  if (!response.ok || !data?.success || typeof data.id !== "string" || !data.id.trim()) {
    throw new Error("Unable to create tiny share link.");
  }

  const shareUrl = new URL(buildApiUrl("/api/share"), current.origin);
  shareUrl.searchParams.set(SHARE_CODE_ID_SEARCH_PARAM, data.id.trim());
  return shareUrl.toString();
}