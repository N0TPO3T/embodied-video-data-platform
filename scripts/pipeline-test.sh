#!/bin/bash
set -e
BASE=http://127.0.0.1:4000/api/v1
ORIGIN="Origin: http://114.55.6.224"
JAR=/tmp/evdp-cookies.txt
rm -f "$JAR"

echo '== 0. generate real mp4 with ffmpeg (unique content) =='
DUR=$((3 + RANDOM % 3))
docker run --rm -v /tmp:/out evdp-media-worker:latest ffmpeg -y -loglevel error \
  -f lavfi -i "testsrc=duration=${DUR}:size=320x240:rate=15" \
  -metadata title="pipeline-test-${RANDOM}" \
  -pix_fmt yuv420p -movflags +faststart /out/pipeline-test.mp4
ls -la /tmp/pipeline-test.mp4
FILE=/tmp/pipeline-test.mp4

PW=${COLLECTOR_PASSWORD:?需要设置 COLLECTOR_PASSWORD 环境变量}
echo '== 1. login =='
curl -s -c "$JAR" -X POST "$BASE/auth/login" -H 'Content-Type: application/json' -H "$ORIGIN" \
  -d "{\"username\":\"ceshirenyuan1\",\"password\":\"$PW\"}" >/dev/null
echo 'login ok'

echo '== 2. create upload =='
SHA=$(sha256sum "$FILE" | awk '{print $1}')
SIZE=$(stat -c%s "$FILE")
CREATE=$(curl -s -b "$JAR" -X POST "$BASE/submissions/uploads" -H 'Content-Type: application/json' -H "$ORIGIN" \
  -d "{\"fileName\":\"pipeline-test.mp4\",\"contentType\":\"video/mp4\",\"sizeBytes\":$SIZE,\"checksumSha256\":\"$SHA\",\"dataUsageAuthorized\":true,\"privacyConfirmed\":true,\"sensitiveContentConfirmed\":true}")
ID=$(echo "$CREATE" | python3 -c 'import json,sys; print(json.load(sys.stdin)["submission"]["id"])')
PSZ=$(echo "$CREATE" | python3 -c 'import json,sys; print(json.load(sys.stdin)["upload"]["partSizeBytes"])')
PCNT=$(echo "$CREATE" | python3 -c 'import json,sys; print(json.load(sys.stdin)["upload"]["partCount"])')
echo "submission=$ID parts=$PCNT size=$SIZE"

echo '== 3. presign + upload + complete =='
PRESIGN=$(curl -s -b "$JAR" -X POST "$BASE/submissions/$ID/uploads/parts" -H 'Content-Type: application/json' -H "$ORIGIN" \
  -d "{\"partNumbers\":[$(seq -s, 1 $PCNT)]}")
echo "$PRESIGN" | python3 -c 'import json,sys; [print(p["partNumber"], p["url"], sep="\t") for p in json.load(sys.stdin)["parts"]]' > /tmp/parts.tsv
ETAGS=""
while IFS=$'\t' read -r PN URL; do
  OFFSET=$(( (PN-1) * PSZ ))
  tail -c +$((OFFSET+1)) "$FILE" | head -c $PSZ > /tmp/part.$PN
  HDR=$(curl -s -D - -o /dev/null -X PUT -H 'Content-Type: video/mp4' --data-binary @/tmp/part.$PN "$URL")
  ETAG=$(echo "$HDR" | grep -i '^etag:' | tr -d '\r' | cut -d' ' -f2)
  echo "  part $PN etag=$ETAG"
  ETAGS="$ETAGS{\"partNumber\":$PN,\"etag\":$ETAG},"
done < /tmp/parts.tsv
ETAGS="[${ETAGS%,}]"
curl -s -b "$JAR" -X POST "$BASE/submissions/$ID/uploads/complete" -H 'Content-Type: application/json' -H "$ORIGIN" \
  -d "{\"parts\":$ETAGS}" | python3 -c 'import json,sys; print("complete:", json.load(sys.stdin)["submission"]["uploadStatus"])'

echo '== 4. poll processing status (up to 4 min) =='
for i in $(seq 1 24); do
  ST=$(curl -s -b "$JAR" "$BASE/submissions/$ID" -H "$ORIGIN" | python3 -c 'import json,sys; d=json.load(sys.stdin); s=d.get("submission",d); print(s.get("processingStatus"), s.get("uploadStatus"), s.get("failureCode") or "")')
  echo "  [$i] $ST"
  case "$ST" in
    completed*) echo "== COMPLETED =="; break ;;
    system_failed*|stuck*) echo "== FAILED =="; break ;;
  esac
  sleep 10
done

echo '== 5. OSS artifacts under this submission =='
echo "$ID" | grep -oE 'SUB-[0-9a-f-]+' >/dev/null
docker exec evdp-postgres-1 psql -U evdp -d evdp -tAc "SELECT object_key FROM submissions WHERE id='$ID';" 2>/dev/null | head -1
PREFIX=$(docker exec evdp-postgres-1 psql -U evdp -d evdp -tAc "SELECT split_part(object_key,'/',1)||'/'||split_part(object_key,'/',2)||'/'||split_part(object_key,'/',3)||'/'||split_part(object_key,'/',4) FROM submissions WHERE id='$ID';" 2>/dev/null | tr -d ' ')
echo "prefix: $PREFIX"
ossutil ls "oss://zrcs-shucai/$PREFIX/" -e https://oss-cn-hangzhou.aliyuncs.com 2>&1 | tail -12

echo "== DONE: submission $ID =="
