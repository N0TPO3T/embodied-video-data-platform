#!/bin/bash
set -e
BASE=http://127.0.0.1:4000/api/v1
ORIGIN="Origin: http://114.55.6.224"
JAR=/tmp/evdp-cookies.txt
rm -f "$JAR"
ADMIN_PW=$(grep '^ceshirenyuan1=' /root/evdp-initial-credentials.txt | cut -d= -f2)
USERNAME=ceshirenyuan1

echo '== 1. login =='
LOGIN=$(curl -s -c "$JAR" -X POST "$BASE/auth/login" -H 'Content-Type: application/json' -H "$ORIGIN" -d "{\"username\":\"$USERNAME\",\"password\":\"$ADMIN_PW\"}")
echo "$LOGIN" | python3 -c 'import json,sys; d=json.load(sys.stdin); print("login ok:", d.get("user",{}).get("username"))'

echo '== 2. create upload (6MB) =='
head -c 6291456 /dev/urandom > /tmp/e2e.bin
SHA=$(sha256sum /tmp/e2e.bin | awk '{print $1}')
SIZE=$(stat -c%s /tmp/e2e.bin)
CREATE=$(curl -s -b "$JAR" -X POST "$BASE/submissions/uploads" -H 'Content-Type: application/json' -H "$ORIGIN" -d "{\"fileName\":\"e2e-test.mp4\",\"contentType\":\"video/mp4\",\"sizeBytes\":$SIZE,\"checksumSha256\":\"$SHA\",\"dataUsageAuthorized\":true,\"privacyConfirmed\":true,\"sensitiveContentConfirmed\":true}")
ID=$(echo "$CREATE" | python3 -c 'import json,sys; print(json.load(sys.stdin)["submission"]["id"])')
PSZ=$(echo "$CREATE" | python3 -c 'import json,sys; print(json.load(sys.stdin)["upload"]["partSizeBytes"])')
PCNT=$(echo "$CREATE" | python3 -c 'import json,sys; print(json.load(sys.stdin)["upload"]["partCount"])')
echo "submission=$ID partSize=$PSZ partCount=$PCNT"

echo '== 3. presign parts =='
PRESIGN=$(curl -s -b "$JAR" -X POST "$BASE/submissions/$ID/uploads/parts" -H 'Content-Type: application/json' -H "$ORIGIN" -d "{\"partNumbers\":[$(seq -s, 1 $PCNT)]}")
echo "$PRESIGN" | python3 -c 'import json,sys; [print(p["partNumber"], p["url"], sep="\t") for p in json.load(sys.stdin)["parts"]]' > /tmp/e2e-parts.tsv
cat /tmp/e2e-parts.tsv | sed 's|\(https://[^/]*/\).*|\1...|' | while read -r pn url; do echo "  part $pn signed"; done

echo '== 4. upload parts via presigned URLs =='
ETAGS=""
while IFS=$'\t' read -r PN URL; do
  OFFSET=$(( (PN-1) * PSZ ))
  tail -c +$((OFFSET+1)) /tmp/e2e.bin | head -c $PSZ > /tmp/e2e.part.$PN
  HDR=$(curl -s -D - -o /dev/null -X PUT -H 'Content-Type: video/mp4' --data-binary @/tmp/e2e.part.$PN "$URL")
  ETAG=$(echo "$HDR" | grep -i '^etag:' | tr -d '\r' | cut -d' ' -f2)
  echo "  part $PN uploaded, etag=$ETAG"
  ETAGS="$ETAGS{\"partNumber\":$PN,\"etag\":$ETAG},"
done < /tmp/e2e-parts.tsv
ETAGS="[${ETAGS%,}]"

echo '== 5. complete upload =='
COMPLETE=$(curl -s -b "$JAR" -X POST "$BASE/submissions/$ID/uploads/complete" -H 'Content-Type: application/json' -H "$ORIGIN" -d "{\"parts\":$ETAGS}")
echo "$COMPLETE" | python3 -c 'import json,sys; d=json.load(sys.stdin); print("complete ok, uploadStatus:", d.get("submission",{}).get("uploadStatus"))'

echo '== 6. verify object exists in OSS =='
OSS_KEY=$(echo "$COMPLETE" | python3 -c 'import json,sys; print(json.load(sys.stdin)["submission"]["objectKey"])')
echo "objectKey=$OSS_KEY"
ossutil stat "oss://zrcs-shucai/$OSS_KEY" -e https://oss-cn-hangzhou.aliyuncs.com 2>&1 | head -8

echo '== 7. verify presigned download through API =='
curl -s -b "$JAR" "$BASE/submissions/$ID/preview" -o /tmp/e2e-download.bin -H "$ORIGIN" -w "preview http=%{http_code} bytes=%{size_download}\n"
cmp -s /tmp/e2e.bin /tmp/e2e-download.bin && echo "content MATCHES original" || echo "content DIFFERS (check)"
echo '== DONE =='
