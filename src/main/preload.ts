import { clipboard, contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("quantikzDesktop", {
  async copyText(text: string): Promise<boolean> {
    clipboard.writeText(text);
    return true;
  },
  async exportQuantikzSvg(code: string): Promise<{ success: boolean; filePath?: string; error?: string }> {
    return ipcRenderer.invoke("quantikz:export-svg", code);
  }
});
