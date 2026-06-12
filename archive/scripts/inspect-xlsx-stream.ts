import ExcelJS from "exceljs";
async function main() {
  const file = process.argv[2];
  const wbr = new ExcelJS.stream.xlsx.WorkbookReader(file, { entries: "emit", sharedStrings: "cache", worksheets: "emit" });
  for await (const ws of wbr) {
    let r = 0;
    for await (const row of ws as AsyncIterable<ExcelJS.Row>) {
      console.log(`Row ${++r}:`, JSON.stringify(row.values));
      if (r >= 3) break;
    }
    break;
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
