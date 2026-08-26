import { env } from "../../config/env";
import { randomUUID } from "node:crypto";

export type StoredMediaMetadata = {
  contentType: string;
  size: number;
  width?: number;
  height?: number;
};

export interface MediaStorageService {
  createUploadTarget(input: {
    projectId: string;
    fileName: string;
    contentType: string;
  }): Promise<{ storageKey: string; uploadUrl: string }>;
  createReadUrl(storageKey: string): Promise<string>;
  delete(storageKey: string): Promise<void>;
  readMetadata(storageKey: string): Promise<StoredMediaMetadata>;
}

export const storageReadiness = {
  provider: "replit-app-storage",
  bucketConfigured: Boolean(env.DEFAULT_OBJECT_STORAGE_BUCKET_ID),
  privateDirectoryConfigured: Boolean(env.PRIVATE_OBJECT_DIR),
  uploadFlow: "direct-presigned-url",
} as const;

const SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

function parseObjectPath(path: string) {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const [, bucketName, ...objectParts] = normalized.split("/");
  if (!bucketName || objectParts.length === 0) throw new Error("Invalid object storage path");
  return { bucketName, objectName: objectParts.join("/") };
}

async function signObjectUrl(storageKey: string, method: "GET" | "PUT" | "DELETE" | "HEAD", ttlSeconds: number) {
  const { bucketName, objectName: privateRoot } = parseObjectPath(env.PRIVATE_OBJECT_DIR);
  const objectName = `${privateRoot.replace(/\/$/, "")}/${storageKey}`;
  const response = await fetch(`${SIDECAR_ENDPOINT}/object-storage/signed-object-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bucket_name: bucketName,
      object_name: objectName,
      method,
      expires_at: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Object URL signing failed with ${response.status}`);
  return (await response.json() as { signed_url: string }).signed_url;
}

class ReplitMediaStorageService implements MediaStorageService {
  async createUploadTarget(input: { projectId: string; fileName: string; contentType: string }) {
    const extension = input.contentType === "image/png" ? "png" : input.contentType === "image/webp" ? "webp" : "jpg";
    const storageKey = `uploads/${randomUUID()}.${extension}`;
    return { storageKey, uploadUrl: await signObjectUrl(storageKey, "PUT", 900) };
  }

  createReadUrl(storageKey: string) {
    return signObjectUrl(storageKey, "GET", 300);
  }

  async delete(storageKey: string) {
    const deleteUrl = await signObjectUrl(storageKey, "DELETE", 300);
    const response = await fetch(deleteUrl, { method: "DELETE", signal: AbortSignal.timeout(30_000) });
    if (!response.ok && response.status !== 404) throw new Error(`Object deletion failed with ${response.status}`);
  }

  async readMetadata(storageKey: string): Promise<StoredMediaMetadata> {
    const headUrl = await signObjectUrl(storageKey, "HEAD", 300);
    const response = await fetch(headUrl, { method: "HEAD", signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Uploaded object not found (${response.status})`);
    const size = Number(response.headers.get("content-length"));
    const contentType = response.headers.get("content-type")?.split(";")[0] ?? "";
    if (!Number.isSafeInteger(size) || size <= 0 || !contentType) throw new Error("Uploaded object metadata is incomplete");
    return { contentType, size };
  }
}

export const mediaStorage = new ReplitMediaStorageService();