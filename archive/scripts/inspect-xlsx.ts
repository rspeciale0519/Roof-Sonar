import ExcelJS from "exceljs";
async function main() {
  const file = process.argv[2];
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  wb.eachSheet((ws) => {
    console.log(`Sheet: "${ws.name}"  rows=${ws.rowCount}  cols=${ws.columnCount}`);
    const header = ws.getRow(1).values as unknown[];
    console.log("Header:", JSON.stringify(header));
    for (let r = 2; r <= Math.min(4, ws.rowCount); r++) {
      console.log(`Row ${r}:`, JSON.stringify(ws.getRow(r).values));
    }
  });
}
main().catch((e) => { console.error(e); process.exit(1); });
