"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const node_child_process_1 = require("node:child_process");
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
const TEXBIN_PATH = "/Library/TeX/texbin";
function createWindow() {
    const window = new electron_1.BrowserWindow({
        width: 1620,
        height: 980,
        minWidth: 1200,
        minHeight: 760,
        backgroundColor: "#f5efe2",
        title: "Quantikz Desktop Editor",
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            preload: node_path_1.default.join(__dirname, "preload.js")
        }
    });
    window.webContents.setWindowOpenHandler(({ url }) => {
        void electron_1.shell.openExternal(url);
        return { action: "deny" };
    });
    if (isDev) {
        void window.loadURL(process.env.VITE_DEV_SERVER_URL);
        window.webContents.openDevTools({ mode: "detach" });
    }
    else {
        void window.loadFile(node_path_1.default.join(__dirname, "../dist/renderer/index.html"));
    }
    return window;
}
function resolveTeXBinary(binaryName) {
    return node_path_1.default.join(TEXBIN_PATH, binaryName);
}
function runCommand(binary, args, cwd) {
    return new Promise((resolve, reject) => {
        (0, node_child_process_1.execFile)(binary, args, { cwd }, (error, stdout, stderr) => {
            if (error) {
                const output = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
                reject(new Error(output || error.message));
                return;
            }
            resolve();
        });
    });
}
function buildStandaloneDocument(code) {
    return [
        "\\documentclass[tikz,border=4pt]{standalone}",
        "\\usepackage{tikz}",
        "\\usetikzlibrary{quantikz2}",
        "\\providecommand{\\ket}[1]{\\left|#1\\right\\rangle}",
        "\\providecommand{\\bra}[1]{\\left\\langle#1\\right|}",
        "\\providecommand{\\proj}[1]{\\left|#1\\right\\rangle\\left\\langle#1\\right|}",
        "\\begin{document}",
        code,
        "\\end{document}"
    ].join("\n");
}
async function exportQuantikzSvg(code) {
    const parentWindow = electron_1.BrowserWindow.getFocusedWindow() ?? electron_1.BrowserWindow.getAllWindows()[0];
    const saveResult = await electron_1.dialog.showSaveDialog(parentWindow, {
        title: "Export Quantikz SVG",
        defaultPath: "quantikz-circuit.svg",
        filters: [{ name: "SVG", extensions: ["svg"] }]
    });
    if (saveResult.canceled || !saveResult.filePath) {
        return { success: false };
    }
    const tempDir = await node_fs_1.promises.mkdtemp(node_path_1.default.join(electron_1.app.getPath("temp"), "quantikz-svg-"));
    const texFilePath = node_path_1.default.join(tempDir, "circuit.tex");
    const dviFilePath = node_path_1.default.join(tempDir, "circuit.dvi");
    const svgFilePath = node_path_1.default.join(tempDir, "circuit.svg");
    try {
        await node_fs_1.promises.writeFile(texFilePath, buildStandaloneDocument(code), "utf8");
        await runCommand(resolveTeXBinary("latex"), ["-interaction=nonstopmode", "-halt-on-error", "-output-directory", tempDir, texFilePath], tempDir);
        await runCommand(resolveTeXBinary("dvisvgm"), ["-n", "-o", svgFilePath, dviFilePath], tempDir);
        await node_fs_1.promises.copyFile(svgFilePath, saveResult.filePath);
        return { success: true, filePath: saveResult.filePath };
    }
    catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : "Unable to export SVG."
        };
    }
    finally {
        await node_fs_1.promises.rm(tempDir, { recursive: true, force: true });
    }
}
electron_1.app.whenReady().then(() => {
    electron_1.ipcMain.handle("quantikz:export-svg", async (_event, code) => exportQuantikzSvg(code));
    createWindow();
    electron_1.app.on("activate", () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});
electron_1.app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        electron_1.app.quit();
    }
});
//# sourceMappingURL=main.js.map