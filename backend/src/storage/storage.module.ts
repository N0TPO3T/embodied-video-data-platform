import { Module } from "@nestjs/common";

import { MinioObjectStorageService } from "./minio-object-storage.service.js";
import { OBJECT_STORAGE } from "./object-storage.port.js";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

@Module({
  providers: [
    {
      provide: OBJECT_STORAGE,
      useFactory: () =>
        new MinioObjectStorageService(
          process.env.MINIO_BUCKET?.trim() || "evdp-videos",
          {
            endpoint: required("MINIO_ENDPOINT"),
            publicEndpoint: required("MINIO_PUBLIC_ENDPOINT"),
            accessKey: required("MINIO_ACCESS_KEY"),
            secretKey: required("MINIO_SECRET_KEY"),
          },
        ),
    },
  ],
  exports: [OBJECT_STORAGE],
})
export class StorageModule {}
