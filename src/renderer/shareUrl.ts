import { DEFAULT_EXPORT_PREAMBLE } from "./document";

export const SHARE_CODE_SEARCH_PARAM = "q";
export const SHARE_PREAMBLE_SEARCH_PARAM = "qp";
export const SHARE_PREVIEW_IMAGE_ID_SEARCH_PARAM = "img";

export interface SharedCircuitPayload {
  code: string;
  preamble: string;
}

export function readSharedCircuitFromSearch(
  locationSearch: string,
  fallbackPreamble = DEFAULT_EXPORT_PREAMBLE
): SharedCircuitPayload | null {
  const params = new URLSearchParams(locationSearch);
  const code = params.get(SHARE_CODE_SEARCH_PARAM);

  if (!code) {
    return null;
  }

  return {
    code,
    preamble: params.get(SHARE_PREAMBLE_SEARCH_PARAM) ?? fallbackPreamble
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

  nextUrl.searchParams.set(SHARE_CODE_SEARCH_PARAM, code);

  if (preamble.trim() && preamble !== fallbackPreamble) {
    nextUrl.searchParams.set(SHARE_PREAMBLE_SEARCH_PARAM, preamble);
  } else {
    nextUrl.searchParams.delete(SHARE_PREAMBLE_SEARCH_PARAM);
  }

  return nextUrl.toString();
}

export function buildShareLandingUrl(
  currentUrl: string,
  code: string,
  preamble: string,
  previewImageId?: string
): string {
  const current = new URL(currentUrl);
  const appUrl = buildSharedCircuitUrl(`${current.origin}/`, code, preamble);
  const appUrlParams = new URL(appUrl).searchParams;
  const shareUrl = new URL("/api/share", current.origin);

  const codeValue = appUrlParams.get(SHARE_CODE_SEARCH_PARAM);
  if (codeValue) {
    shareUrl.searchParams.set(SHARE_CODE_SEARCH_PARAM, codeValue);
  }

  const preambleValue = appUrlParams.get(SHARE_PREAMBLE_SEARCH_PARAM);
  if (preambleValue) {
    shareUrl.searchParams.set(SHARE_PREAMBLE_SEARCH_PARAM, preambleValue);
  }

  if (previewImageId?.trim()) {
    shareUrl.searchParams.set(SHARE_PREVIEW_IMAGE_ID_SEARCH_PARAM, previewImageId.trim());
  }

  return shareUrl.toString();
}