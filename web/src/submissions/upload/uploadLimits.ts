export const MAX_UPLOAD_SIZE_BYTES = 2 * 1024 * 1024 * 1024;

export function uploadSizeError(file: Pick<File, "size">): string | undefined {
  if (file.size < 1) return "视频文件不能为空";
  if (file.size > MAX_UPLOAD_SIZE_BYTES) {
    return "单个视频不能超过 2 GiB";
  }
  return undefined;
}

export function requireSupportedUploadSize(file: Pick<File, "size">): void {
  const message = uploadSizeError(file);
  if (message) throw new Error(message);
}
