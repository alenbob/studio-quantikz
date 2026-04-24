import { describe, expect, it } from "vitest";
import pako from "pako";

import handler from "../api/share";
import { storeShareCode } from "../src/server/shareCodeStore";

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

function compressPayload(code: string, preamble: string): string {
  const payload = preamble ? [code, preamble] : [code];
  const jsonStr = JSON.stringify(payload);
  const compressed = pako.deflate(jsonStr);
  return encodeToBase62(compressed);
}

describe("share api", () => {
  it("returns an OG-enabled landing page when preview image id is provided", async () => {
    const code = String.raw`\begin{quantikz}
& \gate{H}
\end{quantikz}`;
    const compressedCode = compressPayload(code, "");

    const request = {
      method: "GET",
      headers: {
        host: "example.com",
        "x-forwarded-proto": "https"
      },
      query: {
        q: compressedCode,
        img: "preview-1.png"
      }
    };

    const responseState: { statusCode?: number; headers: Record<string, string>; body?: string } = {
      headers: {}
    };

    const response = {
      setHeader(name: string, value: string) {
        responseState.headers[name] = value;
        return this;
      },
      status(code: number) {
        responseState.statusCode = code;
        return this;
      },
      send(body: string) {
        responseState.body = body;
        return this;
      }
    };

    await handler(request, response);

    expect(responseState.statusCode).toBe(200);
    expect(responseState.headers["Content-Type"]).toBe("text/html; charset=utf-8");
    expect(responseState.body).toContain('property="og:image" content="https://example.com/api/share-preview-image?id=preview-1.png"');
    expect(responseState.body).toContain('name="twitter:card" content="summary_large_image"');
    expect(responseState.body).toContain('window.location.replace(');
  });

  it("returns a landing page without image tags when no preview image id is provided", async () => {
    const code = String.raw`\begin{quantikz}& \gate{H}\end{quantikz}`;
    const compressedCode = compressPayload(code, "");

    const request = {
      method: "GET",
      headers: {
        host: "example.com",
        "x-forwarded-proto": "https"
      },
      query: {
        q: compressedCode
      }
    };

    const responseState: { statusCode?: number; body?: string } = {};
    const response = {
      setHeader() {
        return this;
      },
      status(code: number) {
        responseState.statusCode = code;
        return this;
      },
      send(body: string) {
        responseState.body = body;
        return this;
      }
    };

    await handler(request, response);

    expect(responseState.statusCode).toBe(200);
    expect(responseState.body).toContain('name="twitter:card" content="summary"');
    expect(responseState.body).not.toContain('property="og:image"');
  });

  it("uses preview image stored in tiny link payload", async () => {
    const shortId = await storeShareCode(
      String.raw`\begin{quantikz}& \gate{H}\end{quantikz}`,
      "",
      "preview-1.png"
    );

    const request = {
      method: "GET",
      headers: {
        host: "example.com",
        "x-forwarded-proto": "https"
      },
      query: {
        s: shortId
      }
    };

    const responseState: { statusCode?: number; body?: string } = {};
    const response = {
      setHeader() {
        return this;
      },
      status(code: number) {
        responseState.statusCode = code;
        return this;
      },
      send(body: string) {
        responseState.body = body;
        return this;
      }
    };

    await handler(request, response);

    expect(responseState.statusCode).toBe(200);
    expect(responseState.body).toContain('property="og:image" content="https://example.com/api/share-preview-image?id=preview-1.png"');
  });

  it("redirects tiny links to the configured public app url", async () => {
    const shortId = await storeShareCode(
      String.raw`\begin{quantikz}& \gate{H}\end{quantikz}`,
      ""
    );
    const previousPublicAppUrl = process.env.PUBLIC_APP_URL;
    process.env.PUBLIC_APP_URL = "https://alice.github.io/quantikzz/";

    const request = {
      method: "GET",
      headers: {
        host: "example.com",
        "x-forwarded-proto": "https"
      },
      query: {
        s: shortId
      }
    };

    const responseState: { statusCode?: number; body?: string } = {};
    const response = {
      setHeader() {
        return this;
      },
      status(code: number) {
        responseState.statusCode = code;
        return this;
      },
      send(body: string) {
        responseState.body = body;
        return this;
      }
    };

    try {
      await handler(request, response);
    } finally {
      if (previousPublicAppUrl === undefined) {
        delete process.env.PUBLIC_APP_URL;
      } else {
        process.env.PUBLIC_APP_URL = previousPublicAppUrl;
      }
    }

    expect(responseState.statusCode).toBe(200);
    expect(responseState.body).toContain('window.location.replace("https://alice.github.io/quantikzz/?q=');
  });
});