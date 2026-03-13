export {};

declare global {
  interface Window {
    quantikzDesktop?: {
      copyText(text: string): Promise<boolean>;
      exportQuantikzSvg(code: string): Promise<{
        success: boolean;
        filePath?: string;
        error?: string;
      }>;
    };
  }
}
