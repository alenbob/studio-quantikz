const ALLOW_METHODS = "GET,POST,OPTIONS";
const ALLOW_HEADERS = "Content-Type, Authorization, X-Bug-Report-Admin-Token";

function setResponseHeader(response: any, name: string, value: string): void {
  if (typeof response.setHeader === "function") {
    response.setHeader(name, value);
  }
}

export function applyCors(response: any): void {
  setResponseHeader(response, "Access-Control-Allow-Origin", "*");
  setResponseHeader(response, "Access-Control-Allow-Methods", ALLOW_METHODS);
  setResponseHeader(response, "Access-Control-Allow-Headers", ALLOW_HEADERS);
  setResponseHeader(response, "Access-Control-Max-Age", "86400");
}

function endPreflight(response: any): void {
  if (typeof response.status === "function") {
    response.status(204);
  } else {
    response.statusCode = 204;
  }

  if (typeof response.end === "function") {
    response.end();
    return;
  }

  if (typeof response.send === "function") {
    response.send("");
  }
}

export function handleCors(request: any, response: any): boolean {
  applyCors(response);
  if (request.method === "OPTIONS") {
    endPreflight(response);
    return true;
  }

  return false;
}