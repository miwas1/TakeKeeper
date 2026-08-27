import { env } from "../../config/env";
import { mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

export type StoredMediaMetadata = {
  contentType: string;
  size: number;
  width: number;
  height: number;
};

export class MediaUploadTooLargeError extends Error {
  readonly code = "MEDIA_UPLOAD_TOO_LARGE";

  constructor() {
    super("Uploaded media exceeds its reserved size");
  }
}

export interface MediaStorageService {
  readonly isLocal: boolean;
  createUploadTarget(input: {
    projectId: string;
    fileName: string;
    contentType: string;
  }): Promise<{ storageKey: string; uploadUrl: string }>;
  createReadUrl(storageKey: string): Promise<string>;
  delete(storageKey: string): Promise<void>;
  readMetadata(storageKey: string): Promise<StoredMediaMetadata>;
  writeUpload?(body: AsyncIterable<Uint8Array>, storageKey: string, maxSize: number): Promise<void>;
  resolveReadToken?(token: string): string | undefined;
  getFilePath?(storageKey: string): string;
}

const usesLocalStorage = env.DATABASE_URL.startsWith("pglite");

export const storageReadiness = {
  provider: usesLocalStorage ? "local-filesystem" : "replit-app-storage",
  bucketConfigured: Boolean(env.DEFAULT_OBJECT_STORAGE_BUCKET_ID),
  privateDirectoryConfigured: Boolean(env.PRIVATE_OBJECT_DIR),
  uploadFlow: usesLocalStorage ? "api-local-upload" : "direct-presigned-url",
} as const;

const SIDECAR_ENDPOINT = "http://127.0.0.1:1106";
const MAX_VERIFIED_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_VERIFIED_IMAGE_DIMENSION = 16_000;

const LOCAL_STORAGE_UPLOAD_ROUTE = "/api/storage/local-uploads";
const LOCAL_STORAGE_READ_ROUTE = "/api/storage/local-objects";

function localStorageRoot() {
  return path.resolve(process.env.TAKEKEEPER_LOCAL_STORAGE_DIR ?? path.resolve(process.cwd(), ".takekeeper", "object-storage"));
}

function localFilePath(root: string, storageKey: string) {
  const normalized = storageKey.replaceAll("\\", "/");
  if (!/^uploads\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(normalized)) throw new Error("Invalid local object key");
  const resolved = path.resolve(root, normalized);
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Invalid local object path");
  return resolved;
}

function parseObjectPath(path: string) {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const [, bucketName, ...objectParts] = normalized.split("/");
  if (!bucketName || objectParts.length === 0) throw new Error("Invalid object storage path");
  return { bucketName, objectName: objectParts.join("/") };
}

async function signObjectUrl(storageKey: string, method: "GET" | "PUT" | "DELETE" | "HEAD", ttlSeconds: number) {
  if (!env.PRIVATE_OBJECT_DIR) throw new Error("PRIVATE_OBJECT_DIR is required for Replit App Storage");
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

function startsWithBytes(bytes: Uint8Array, values: number[], offset = 0) {
  return values.every((value, index) => bytes[offset + index] === value);
}

function parsePng(bytes: Uint8Array) {
  if (bytes.length < 24 || !startsWithBytes(bytes, [137, 80, 78, 71, 13, 10, 26, 10])) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { contentType: "image/png", width: view.getUint32(16), height: view.getUint32(20) };
}

function parseWebp(bytes: Uint8Array) {
  if (bytes.length < 16 || !startsWithBytes(bytes, [82, 73, 70, 70]) || !startsWithBytes(bytes, [87, 69, 66, 80], 8)) return null;
  const chunk = String.fromCharCode(...bytes.subarray(12, 16));
  if (chunk === "VP8X" && bytes.length >= 30) {
    const width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16);
    const height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16);
    return { contentType: "image/webp", width, height };
  }
  if (chunk === "VP8 " && bytes.length >= 30 && startsWithBytes(bytes, [157, 1, 42], 23)) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { contentType: "image/webp", width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
  }
  if (chunk === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) {
    const width = 1 + bytes[21] + ((bytes[22] & 0x3f) << 8);
    const height = 1 + ((bytes[22] >> 6) & 0x03) + (bytes[23] << 2) + ((bytes[24] & 0xf0) << 10);
    return { contentType: "image/webp", width, height };
  }
  return null;
}

function parseJpeg(bytes: Uint8Array) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (offset + 2 > bytes.length) break;
    const segmentLength = (bytes[offset] << 8) + bytes[offset + 1];
    if (segmentLength < 2 || offset + segmentLength > bytes.length) break;
    const isStartOfFrame = marker >= 0xc0 && marker <= 0xc3 || marker >= 0xc5 && marker <= 0xc7 || marker >= 0xc9 && marker <= 0xcb || marker >= 0xcd && marker <= 0xcf;
    if (isStartOfFrame && segmentLength >= 7) {
      return { contentType: "image/jpeg", height: (bytes[offset + 3] << 8) + bytes[offset + 4], width: (bytes[offset + 5] << 8) + bytes[offset + 6] };
    }
    offset += segmentLength;
  }
  return null;
}

function parseImage(bytes: Uint8Array) {
  return parsePng(bytes) ?? parseWebp(bytes) ?? parseJpeg(bytes);
}

class ReplitMediaStorageService implements MediaStorageService {
  readonly isLocal = false;

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
    const reportedContentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
    if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_VERIFIED_IMAGE_BYTES || !reportedContentType) throw new Error("Uploaded object metadata is incomplete or too large");
    const readUrl = await signObjectUrl(storageKey, "GET", 300);
    const bytesResponse = await fetch(readUrl, {
      headers: { Range: "bytes=0-131071" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!bytesResponse.ok) throw new Error(`Uploaded object could not be read (${bytesResponse.status})`);
    let detected = parseImage(new Uint8Array(await bytesResponse.arrayBuffer()));
    if (!detected && bytesResponse.status === 206) {
      const fullResponse = await fetch(readUrl, { signal: AbortSignal.timeout(30_000) });
      if (fullResponse.ok) detected = parseImage(new Uint8Array(await fullResponse.arrayBuffer()));
    }
    if (!detected || (reportedContentType !== detected.contentType && reportedContentType !== "application/octet-stream") || detected.width <= 0 || detected.height <= 0 || detected.width > MAX_VERIFIED_IMAGE_DIMENSION || detected.height > MAX_VERIFIED_IMAGE_DIMENSION) {
      throw new Error("Uploaded object is not a supported image");
    }
    return { contentType: detected.contentType, size, width: detected.width, height: detected.height };
  }
}

class LocalFilesystemMediaStorageService implements MediaStorageService {
  readonly isLocal = true;
  private readonly root = localStorageRoot();
  private readonly readTokens = new Map<string, string>();

  private async ensureRoot() {
    await mkdir(this.root, { recursive: true });
  }

  async createUploadTarget(_input: { projectId: string; fileName: string; contentType: string }) {
    await this.ensureRoot();
    const uploadId = randomUUID();
    const storageKey = `uploads/${uploadId}`;
    return { storageKey, uploadUrl: `${LOCAL_STORAGE_UPLOAD_ROUTE}/${uploadId}` };
  }

  createReadUrl(storageKey: string) {
    const token = randomUUID();
    this.readTokens.set(token, storageKey);
    const expiry = setTimeout(() => this.readTokens.delete(token), 5 * 60 * 1000);
    expiry.unref?.();
    return Promise.resolve(`${LOCAL_STORAGE_READ_ROUTE}/${token}`);
  }

  resolveReadToken(token: string) {
    return this.readTokens.get(token);
  }

  getFilePath(storageKey: string) {
    return localFilePath(this.root, storageKey);
  }

  async writeUpload(body: AsyncIterable<Uint8Array>, storageKey: string, maxSize: number) {
    await this.ensureRoot();
    const filePath = this.getFilePath(storageKey);
    await mkdir(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${randomUUID()}.part`;
    const handle = await open(temporaryPath, "w");
    let size = 0;
    try {
      for await (const chunk of body) {
        size += chunk.byteLength;
        if (size > maxSize) throw new MediaUploadTooLargeError();
        await handle.write(chunk);
      }
      await handle.close();
      await rename(temporaryPath, filePath);
    } catch (error) {
      await handle.close().catch(() => undefined);
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
  }

  async delete(storageKey: string) {
    await unlink(this.getFilePath(storageKey)).catch((error: unknown) => {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
    });
  }

  async readMetadata(storageKey: string): Promise<StoredMediaMetadata> {
    const filePath = this.getFilePath(storageKey);
    const fileStats = await stat(filePath);
    if (!fileStats.isFile() || fileStats.size <= 0 || fileStats.size > MAX_VERIFIED_IMAGE_BYTES) {
      throw new Error("Local media object is missing or too large");
    }
    const detected = parseImage(new Uint8Array(await readFile(filePath)));
    if (!detected || detected.width <= 0 || detected.height <= 0 || detected.width > MAX_VERIFIED_IMAGE_DIMENSION || detected.height > MAX_VERIFIED_IMAGE_DIMENSION) {
      throw new Error("Local media object is not a supported image");
    }
    return { contentType: detected.contentType, size: fileStats.size, width: detected.width, height: detected.height };
  }
}

export const mediaStorage: MediaStorageService = usesLocalStorage
  ? new LocalFilesystemMediaStorageService()
  : new ReplitMediaStorageService();
