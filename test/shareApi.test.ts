import { describe, expect, it } from "vitest";

import handler from "../api/share";

describe("share api", () => {
  it("returns an OG-enabled landing page when preview image id is provided", async () => {
    const request = {
      method: "GET",
      headers: {
        host: "example.com",
        "x-forwarded-proto": "https"
      },
      query: {
        q: String.raw`\begin{quantikz}
& \gate{H}
\end{quantikz}`,
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
    const request = {
      method: "GET",
      headers: {
        host: "example.com",
        "x-forwarded-proto": "https"
      },
      query: {
        q: String.raw`\begin{quantikz}& \gate{H}\end{quantikz}`
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
});