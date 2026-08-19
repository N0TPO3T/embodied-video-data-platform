// Check access to the specific zrcs-shucai bucket via S3-compatible API.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  S3Client,
  HeadBucketCommand,
  ListObjectsV2Command,
  GetBucketLocationCommand,
} from "@aws-sdk/client-s3";

const region = "cn-hangzhou";
const endpoint = `https://s3.oss-${region}.aliyuncs.com`;
const bucket = process.env.OSS_BUCKET || "zrcs-shucai";

let ak = process.env.OSS_AK;
let sk = process.env.OSS_SK;
if (!ak || !sk) {
  const config = JSON.parse(
    readFileSync(join(homedir(), ".workbench", "config.json"), "utf8"),
  );
  const profile = config.profiles[config.current] || config.profiles.default;
  ak = profile.access_key_id;
  sk = profile.access_key_secret;
}

const client = new S3Client({
  region,
  endpoint,
  forcePathStyle: false,
  credentials: {
    accessKeyId: ak,
    secretAccessKey: sk,
  },
});

async function tryCmd(name, cmd) {
  try {
    const res = await client.send(cmd);
    console.log(`OK   ${name}`);
    return res;
  } catch (e) {
    console.log(`FAIL ${name}: ${e.name} ${e.message}`);
    console.log(`     http=${e.$metadata?.httpStatusCode} code=${e.Code}`);
    return null;
  }
}

await tryCmd("HeadBucket zrcs-shucai", new HeadBucketCommand({ Bucket: bucket }));
const list = await tryCmd(
  "ListObjectsV2 zrcs-shucai",
  new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 5 }),
);
if (list?.Contents?.length) {
  console.log("     first objects:", list.Contents.map((o) => o.Key).join(", "));
} else if (list) {
  console.log("     bucket is empty");
}
await tryCmd(
  "GetBucketLocation zrcs-shucai",
  new GetBucketLocationCommand({ Bucket: bucket }),
);
