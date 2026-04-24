function normalizeApiBaseUrl(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    parsed.search = "";
    parsed.hash = "";
    if (!parsed.pathname.endsWith("/")) {
      parsed.pathname = `${parsed.pathname}/`;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function normalizeApiPath(path: string): string {
  return path.replace(/^\/+/, "");
}

const configuredApiBaseUrl = normalizeApiBaseUrl(import.meta.env.VITE_API_BASE_URL);

export function hasConfiguredApiBaseUrl(): boolean {
  return Boolean(configuredApiBaseUrl);
}

export function buildApiUrl(path: string): string {
  const normalizedPath = normalizeApiPath(path);
  if (!configuredApiBaseUrl) {
    return `/${normalizedPath}`;
  }

  return new URL(normalizedPath, configuredApiBaseUrl).toString();
}