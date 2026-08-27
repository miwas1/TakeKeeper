export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_IMAGE_DIMENSION = 4096;
const COMPRESSION_THRESHOLD_BYTES = 6 * 1024 * 1024;

export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export type ImageDimensions = {
  width: number;
  height: number;
};

export type PreparedImage = ImageDimensions & {
  file: File;
  compressed: boolean;
};

export function validateImageFile(file: File): string | null {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type as (typeof ACCEPTED_IMAGE_TYPES)[number])) {
    return "Choose a JPEG, PNG, or WebP image.";
  }
  if (file.size <= 0) {
    return "That image is empty. Choose another file.";
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return "Choose an image smaller than 20 MB.";
  }
  return null;
}

type DecodedImage = {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
};

async function decodeImage(file: File): Promise<DecodedImage> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      close: () => bitmap.close(),
    };
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.decoding = "async";
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("The image could not be decoded."));
      element.src = objectUrl;
    });
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      close: () => URL.revokeObjectURL(objectUrl),
    };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

export async function inspectImage(file: File): Promise<ImageDimensions> {
  const decoded = await decodeImage(file);
  try {
    return { width: decoded.width, height: decoded.height };
  } finally {
    decoded.close();
  }
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("The image could not be prepared for upload."));
    }, type, quality);
  });
}

function baseName(fileName: string): string {
  const withoutExtension = fileName.replace(/\.[^/.]+$/, "").trim();
  return withoutExtension || "takekeeper-image";
}

export async function prepareImage(file: File): Promise<PreparedImage> {
  const validationError = validateImageFile(file);
  if (validationError) throw new Error(validationError);

  const dimensions = await inspectImage(file);
  const needsCompression = file.size > COMPRESSION_THRESHOLD_BYTES;
  const needsResize = Math.max(dimensions.width, dimensions.height) > MAX_IMAGE_DIMENSION;
  if (!needsCompression && !needsResize) {
    return { file, ...dimensions, compressed: false };
  }

  const decoded = await decodeImage(file);
  try {
    const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(decoded.width, decoded.height));
    const width = Math.max(1, Math.round(decoded.width * scale));
    const height = Math.max(1, Math.round(decoded.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Your browser cannot prepare this image.");
    context.drawImage(decoded.source, 0, 0, width, height);

    const preferredType = file.type === "image/png" ? "image/webp" : "image/jpeg";
    let outputType = preferredType;
    let quality = 0.9;
    let blob = await canvasBlob(canvas, outputType, quality);
    if (blob.size > MAX_IMAGE_BYTES) {
      quality = 0.78;
      blob = await canvasBlob(canvas, outputType, quality);
    }
    if (blob.size > MAX_IMAGE_BYTES && outputType !== "image/jpeg") {
      outputType = "image/jpeg";
      blob = await canvasBlob(canvas, outputType, 0.72);
    }
    if (blob.size > MAX_IMAGE_BYTES) throw new Error("This image is too large to upload after preparation.");

    const extension = outputType === "image/webp" ? "webp" : "jpg";
    const preparedFile = new File([blob], `${baseName(file.name)}.${extension}`, {
      type: outputType,
      lastModified: Date.now(),
    });
    return { file: preparedFile, width, height, compressed: true };
  } finally {
    decoded.close();
  }
}

export function uploadImage(
  uploadUrl: string,
  file: File,
  onProgress?: (progress: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", uploadUrl);
    request.setRequestHeader("Content-Type", file.type);
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100));
    });
    request.addEventListener("load", () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress?.(100);
        resolve();
      } else {
        reject(new Error(`Upload failed (${request.status}).`));
      }
    });
    request.addEventListener("error", () => reject(new Error("The network interrupted the upload.")));
    request.addEventListener("abort", () => reject(new Error("The upload was cancelled.")));
    request.send(file);
  });
}
