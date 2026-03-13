"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld("quantikzDesktop", {
    async copyText(text) {
        electron_1.clipboard.writeText(text);
        return true;
    },
    async exportQuantikzSvg(code) {
        return electron_1.ipcRenderer.invoke("quantikz:export-svg", code);
    }
});
//# sourceMappingURL=preload.js.map