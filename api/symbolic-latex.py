import json
import pathlib
import sys
from http.server import BaseHTTPRequestHandler


REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))


class handler(BaseHTTPRequestHandler):
    def _send_json(self, status_code: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Max-Age", "86400")
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Max-Age", "86400")
        self.end_headers()

    def do_POST(self) -> None:
        try:
            content_length = int(self.headers.get("content-length", "0"))
        except ValueError:
            content_length = 0

        try:
            raw_body = self.rfile.read(content_length).decode("utf-8") if content_length > 0 else ""
            parsed = json.loads(raw_body or "{}")
        except json.JSONDecodeError:
            self._send_json(400, {"success": False, "error": "Request body must be valid JSON."})
            return

        code = parsed.get("code", "")
        env_index = parsed.get("envIndex", 0)

        if not isinstance(code, str) or not code.strip():
            self._send_json(400, {"success": False, "error": "Quantikz code is required."})
            return

        if not isinstance(env_index, int) or env_index < 0:
            self._send_json(
                400,
                {"success": False, "error": "The quantikz environment index must be a non-negative integer."},
            )
            return

        try:
            from quantikz_symbolic_latex import generate_symbolic_latex

            latex = generate_symbolic_latex(code, env_index)
            self._send_json(200, {"success": True, "latex": latex, "envIndex": env_index})
        except ValueError as exc:
            self._send_json(400, {"success": False, "error": str(exc)})
        except Exception as exc:
            self._send_json(500, {"success": False, "error": str(exc) or "Unable to generate symbolic LaTeX."})

    def do_GET(self) -> None:
        self._send_json(405, {"success": False, "error": "Method not allowed."})
