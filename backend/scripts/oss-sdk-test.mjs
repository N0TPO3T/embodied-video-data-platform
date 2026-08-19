// Replicates the platform backend's exact object-storage call path against
// Alibaba Cloud OSS S3-compatible endpoint (HTTPS).
import {
  S3Client,
  HeadBucketCommand,
  CreateMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const region = "cn-hangzhou";
const endpoint = process.env.OSS_ENDPOINT || "https://s3.oss-cn-hangzhou.aliyuncs.com";
const bucket = "zrcs-shucai";
const ak = process.env.OSS_AK;
const sk = process.env.OSS_SK;
if (!ak || !sk) throw new Error("OSS_AK / OSS_SK required");

const client = new S3Client({
  region,
  endpoint,
  forcePathStyle: false,
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
  credentials: { accessKeyId: ak, secretAccessKey: sk },
});

const ok = (name) => console.log(`OK   ${name}`);
const fail = (name, e) => {
  console.log(`FAIL ${name}: ${e.name} ${e.message} (http=${e.$metadata?.httpStatusCode})`);
  process.exitCode = 1;
};

// 1. HeadBucket (ensureBucket path)
try {
  await client.send(new HeadBucketCommand({ Bucket: bucket }));
  ok("HeadBucket");
} catch (e) {
  fail("HeadBucket", e);
}

// 2. CreateMultipartUpload with metadata (as the backend does)
let uploadId, key = `sdk-test/${Date.now()}.bin`;
try {
  const r = await client.send(
    new CreateMultipartUploadCommand({
      Bucket: bucket,
      Key: key,
      ContentType: "application/octet-stream",
      Metadata: { "expected-sha256": "abc123" },
    }),
  );
  uploadId = r.UploadId;
  ok(`CreateMultipartUpload (uploadId=${uploadId})`);
} catch (e) {
  fail("CreateMultipartUpload", e);
}

// 3. Presign UploadPart, then PUT the part via the presigned URL
let etag;
try {
  const url = await getSignedUrl(
    client,
    new (await import("@aws-sdk/client-s3")).UploadPartCommand({
      Bucket: bucket,
      Key: key,
      UploadId: uploadId,
      PartNumber: 1,
    }),
    { expiresIn: 3600 },
  );
  const body = Buffer.alloc(6 * 1024 * 1024, 0x61); // 6MB part
  const res = await fetch(url, { method: "PUT", body });
  if (!res.ok) throw new Error(`PUT part http ${res.status}`);
  etag = res.headers.get("etag");
  if (!etag) throw new Error("no etag header in UploadPart response");
  ok(`Presigned UploadPart PUT (status=${res.status}, etag=${etag})`);
} catch (e) {
  fail("Presigned UploadPart", e);
}

// 4. CompleteMultipartUpload
try {
  const r = await client.send(
    new CompleteMultipartUploadCommand({
      Bucket: bucket,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: { Parts: [{ PartNumber: 1, ETag: etag }] },
    }),
  );
  ok(`CompleteMultipartUpload (etag=${r.ETag})`);
} catch (e) {
  fail("CompleteMultipartUpload", e);
}

// 5. Presign GetObject and GET via the URL
try {
  const url = await getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { expiresIn: 3600 },
  );
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET object http ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length !== 6 * 1024 * 1024) throw new Error(`size mismatch: ${buf.length}`);
  ok(`Presigned GetObject (status=${res.status}, bytes=${buf.length})`);
} catch (e) {
  fail("Presigned GetObject", e);
}

// 6. Cleanup
try {
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  ok("DeleteObject");
} catch (e) {
  fail("DeleteObject", e);
}

console.log(process.exitCode ? "RESULT: FAILED" : "RESULT: ALL PASSED");
