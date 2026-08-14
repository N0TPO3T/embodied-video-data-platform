export const OBJECT_STORAGE = Symbol("OBJECT_STORAGE");

export type PresignedUploadPart = {
  partNumber: number;
  url: string;
  expiresAt: Date;
};

export type PresignedDownload = {
  url: string;
  expiresAt: Date;
};

export interface ObjectStoragePort {
  downloadObject(input: {
    objectKey: string;
    destinationPath: string;
  }): Promise<void>;
  readObject(input: {
    objectKey: string;
  }): Promise<NodeJS.ReadableStream>;
  uploadObject(input: {
    objectKey: string;
    sourcePath: string;
    contentType: string;
  }): Promise<void>;
  createMultipartUpload(input: {
    objectKey: string;
    contentType: string;
    checksumSha256: string;
  }): Promise<{ uploadId: string }>;
  presignUploadPart(input: {
    objectKey: string;
    uploadId: string;
    partNumber: number;
    expiresInSeconds: number;
  }): Promise<PresignedUploadPart>;
  presignDownloadObject(input: {
    objectKey: string;
    expiresInSeconds: number;
  }): Promise<PresignedDownload>;
  deleteObject(input: {
    objectKey: string;
  }): Promise<void>;
  completeMultipartUpload(input: {
    objectKey: string;
    uploadId: string;
    parts: Array<{ partNumber: number; etag: string }>;
  }): Promise<{ etag?: string }>;
  headObject(input: { objectKey: string }): Promise<{
    sizeBytes: string;
    etag?: string;
    contentType?: string;
  }>;
  abortMultipartUpload(input: {
    objectKey: string;
    uploadId: string;
  }): Promise<void>;
}
