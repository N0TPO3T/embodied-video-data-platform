export const OBJECT_STORAGE = Symbol("OBJECT_STORAGE");

export type PresignedUploadPart = {
  partNumber: number;
  url: string;
  expiresAt: Date;
};

export interface ObjectStoragePort {
  downloadObject(input: {
    objectKey: string;
    destinationPath: string;
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
