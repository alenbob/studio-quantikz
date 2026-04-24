import { buildApiUrl } from "./api";

interface SharePreviewUploadResponse {
  success?: boolean;
  imageId?: string;
  error?: string;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(new Error("Unable to prepare the share preview image."));
    reader.readAsDataURL(blob);
  });
}

export async function uploadSharePreviewImage(pngBlob: Blob): Promise<string> {
  const imageDataUrl = await blobToDataUrl(pngBlob);

  if (!imageDataUrl.trim()) {
    throw new Error("Unable to prepare the share preview image.");
  }

  const response = await fetch(buildApiUrl("/api/share-preview-image"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ imageDataUrl })
  });

  const parsed = await response.json() as SharePreviewUploadResponse;
  if (!response.ok || !parsed.success || !parsed.imageId?.trim()) {
    throw new Error(parsed.error?.trim() || "Unable to upload the share preview image.");
  }

  return parsed.imageId;
}