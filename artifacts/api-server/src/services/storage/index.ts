import { env } from "../../config/env";

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

export class StorageNotImplementedError extends Error {
  constructor() {
    super("Media upload endpoints are intentionally deferred until authenticated capture is implemented.");
    this.name = "StorageNotImplementedError";
  }
}