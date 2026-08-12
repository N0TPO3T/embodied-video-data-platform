import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const inputPath =
  "outputs/019fcabc-e414-7b02-addb-e06f9e8ba4e3/具身智能视频数据平台_AI快速开发人天评估.xlsx";

const input = await FileBlob.load(inputPath);
const workbook = await SpreadsheetFile.importXlsx(input);

const summary = await workbook.inspect({
  kind: "workbook,sheet,table",
  maxChars: 12000,
  tableMaxRows: 8,
  tableMaxCols: 10,
  tableMaxCellChars: 120,
});

console.log(summary.ndjson);

for (const sheetName of ["总览", "一期明细", "二期明细", "原报价压减"]) {
  const sheet = workbook.worksheets.getItem(sheetName);
  const used = sheet.getUsedRange();
  const region = await workbook.inspect({
    kind: "region",
    sheetId: sheetName,
    range: used.address,
    maxChars: 22000,
    tableMaxRows: 120,
    tableMaxCols: 10,
    tableMaxCellChars: 240,
  });
  console.log(`\n=== ${sheetName} ${used.address} ===`);
  console.log(region.ndjson);
}
