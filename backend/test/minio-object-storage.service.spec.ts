import { MinioObjectStorageService } from "../src/storage/minio-object-storage.service.js";

describe("MinioObjectStorageService presigned uploads", () => {
  it("signs browser uploads with the public endpoint and no empty checksum", async () => {
    const storage = new MinioObjectStorageService("evdp-videos", {
      endpoint: "http://minio:9000",
      publicEndpoint: "http://localhost:9000",
      accessKey: "local-access-key",
      secretKey: "local-secret-key",
    });

    const result = await storage.presignUploadPart({
      objectKey: "uploads/team/user/submission/original.mp4",
      uploadId: "upload-id",
      partNumber: 1,
      expiresInSeconds: 900,
    });

    const url = new URL(result.url);
    expect(url.origin).toBe("http://localhost:9000");
    expect(url.searchParams.has("x-amz-checksum-crc32")).toBe(false);
    expect(url.searchParams.has("x-amz-sdk-checksum-algorithm")).toBe(false);
  });
});
