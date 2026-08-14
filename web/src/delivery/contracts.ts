export type BackendDeliveryPackageItem = {
  id: string;
  submissionId: string;
  fileName: string;
  objectKey: string;
  ownerName: string;
  teamName: string;
  finalScore: number;
  points: number;
  sizeBytes: string;
};

export type BackendDeliveryPackage = {
  id: string;
  name: string;
  status: "ready";
  assetCount: number;
  totalSizeBytes: string;
  createdByAccountId: string;
  createdByName: string;
  createdAt: number;
  items: BackendDeliveryPackageItem[];
};

export type BackendDeliveryPreview = {
  assetCount: number;
  totalSizeBytes: string;
};

export type BackendDeliveryDownloadLink = {
  packageItemId: string;
  submissionId: string;
  fileName: string;
  objectKey: string;
  sizeBytes: string;
  url: string;
  expiresAt: number;
};

export type BackendDeliveryDownloadLinks = {
  package: BackendDeliveryPackage;
  expiresInSeconds: number;
  links: BackendDeliveryDownloadLink[];
};

export type BackendDeliveryArchiveFormat = "zip" | "tar";

export type BackendDeliveryArchiveTask = {
  id: string;
  packageId: string;
  format: BackendDeliveryArchiveFormat;
  status: "queued" | "processing" | "completed" | "failed";
  assetCount: number;
  processedAssetCount: number;
  totalSizeBytes: string;
  processedSizeBytes: string;
  progressPercent: number;
  archiveObjectKey?: string;
  archiveSizeBytes?: string;
  fileName: string;
  failureMessage?: string;
  requestedByAccountId: string;
  requestedByName: string;
  startedAt?: number;
  finishedAt?: number;
  createdAt: number;
  updatedAt: number;
};

export type BackendDeliveryArchiveDownloadLink = {
  task: BackendDeliveryArchiveTask;
  url: string;
  expiresAt: number;
  expiresInSeconds: number;
};
