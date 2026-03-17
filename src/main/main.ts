import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
const TEXBIN_PATH = "/Library/TeX/texbin";

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1620,
    height: 980,
    minWidth: 1200,
    minHeight: 760,
    backgroundColor: "#f5efe2",
    title: "Quantikz Desktop Editor",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js")
    }
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  if (isDev) {
    void window.loadURL(process.env.VITE_DEV_SERVER_URL as string);
    window.webContents.openDevTools({ mode: "detach" });
  } else {
    void window.loadFile(path.join(__dirname, "../dist/renderer/index.html"));
  }

  return window;
}

function resolveTeXBinary(binaryName: string): string {
  return path.join(TEXBIN_PATH, binaryName);
}

function runCommand(binary: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(binary, args, { cwd }, (error, stdout, stderr) => {
      if (error) {
        const output = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
        reject(new Error(output || error.message));
        return;
      }

      resolve();
    });
  });
}

function buildStandaloneDocument(code: string): string {
  return [
    "\\documentclass[tikz,border=4pt]{standalone}",
    "\\usepackage{tikz}",
    "\\usetikzlibrary{quantikz2}",
    "\\usepackage{amsmath}",
    "\\usepackage{amssymb}",
    "\\usepackage{amsfonts}",
    "\\usepackage{braket}",
    "\\begin{document}",
    code,
    "\\end{document}"
  ].join("\n");
}

async function exportQuantikzSvg(code: string): Promise<{ success: boolean; filePath?: string; error?: string }> {
  const parentWindow = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  const saveResult = await dialog.showSaveDialog(parentWindow, {
    title: "Export Quantikz SVG",
    defaultPath: "quantikz-circuit.svg",
    filters: [{ name: "SVG", extensions: ["svg"] }]
  });

  if (saveResult.canceled || !saveResult.filePath) {
    return { success: false };
  }

  const tempDir = await fs.mkdtemp(path.join(app.getPath("temp"), "quantikz-svg-"));
  const texFilePath = path.join(tempDir, "circuit.tex");
  const dviFilePath = path.join(tempDir, "circuit.dvi");
  const svgFilePath = path.join(tempDir, "circuit.svg");

  try {
    await fs.writeFile(texFilePath, buildStandaloneDocument(code), "utf8");

    await runCommand(
      resolveTeXBinary("latex"),
      ["-interaction=nonstopmode", "-halt-on-error", "-output-directory", tempDir, texFilePath],
      tempDir
    );

    await runCommand(
      resolveTeXBinary("dvisvgm"),
      ["-n", "-o", svgFilePath, dviFilePath],
      tempDir
    );

    await fs.copyFile(svgFilePath, saveResult.filePath);
    return { success: true, filePath: saveResult.filePath };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unable to export SVG."
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

app.whenReady().then(() => {
  ipcMain.handle("quantikz:export-svg", async (_event, code: string) => exportQuantikzSvg(code));

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
