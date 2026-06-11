# Export roof permits + parcel attributes + situs addresses from the VCPA
# weekly CAMA Access database to CSVs for scripts/ingest-volusia-cama.ts.
#
#   1. Download https://vcpa.vcgov.org/files/database/CAMA_DATA_EXPORT.zip
#      and extract to data/inbox/volusia-cama/  (refreshed weekly by VCPA)
#   2. pwsh scripts/export-volusia-cama.ps1
#   3. npx tsx scripts/ingest-volusia-cama.ts
#
# Requires the Microsoft ACE OLEDB provider (ships with Office / Access
# Database Engine Redistributable).

$ErrorActionPreference = "Stop"
$accdb = Join-Path $PWD "data\inbox\volusia-cama\CAMA_DATA_EXPORT_WEB.accdb"
$outDir = Join-Path $PWD "data\inbox\volusia-cama"
if (-not (Test-Path $accdb)) { throw "Access DB not found at $accdb" }

$conn = New-Object System.Data.OleDb.OleDbConnection("Provider=Microsoft.ACE.OLEDB.16.0;Data Source=$accdb;")
$conn.Open()

function Export-Query([string]$name, [string]$sql, [string[]]$columns) {
    Write-Host "exporting $name..."
    $cmd = $conn.CreateCommand()
    $cmd.CommandText = $sql
    $cmd.CommandTimeout = 1800
    $da = New-Object System.Data.OleDb.OleDbDataAdapter($cmd)
    $dt = New-Object System.Data.DataTable
    [void]$da.Fill($dt)
    $dest = Join-Path $outDir "$name.csv"
    $dt | Select-Object $columns | Export-Csv $dest -NoTypeInformation -Encoding UTF8
    Write-Host "  $($dt.Rows.Count) rows -> $dest"
}

Export-Query "volusia-roof-permits" @"
SELECT PARID, NUM, PERMDT, ISSUED_BY, STATUS, WORK_TYPE, WORK_DESC, CONTRACTOR, AMOUNT, COMPL_DATE
FROM VCPA_CAMA_PERMITS
WHERE WORK_DESC LIKE '%ROOF%' OR WORK_TYPE LIKE '%ROOF%'
"@ @("PARID","NUM","PERMDT","ISSUED_BY","STATUS","WORK_TYPE","WORK_DESC","CONTRACTOR","AMOUNT","COMPL_DATE")

Export-Query "volusia-parcels" @"
SELECT PARID, DORID, LUC, LUC_DESC, TAXDIST_DESC
FROM VCPA_CAMA_PARCEL
WHERE TAXYR = (SELECT MAX(TAXYR) FROM VCPA_CAMA_PARCEL)
"@ @("PARID","DORID","LUC","LUC_DESC","TAXDIST_DESC")

Export-Query "volusia-situs" @"
SELECT PARID, OWNSEQ, ADRNO, ADRADD, ADRDIR, ADRSTR, ADRSUF, ADRSUF2, UNITDESC, UNITNO, CITYNAME, ZIP1
FROM VCPA_CAMA_SITUS
WHERE TAXYR = (SELECT MAX(TAXYR) FROM VCPA_CAMA_SITUS)
"@ @("PARID","OWNSEQ","ADRNO","ADRADD","ADRDIR","ADRSTR","ADRSUF","ADRSUF2","UNITDESC","UNITNO","CITYNAME","ZIP1")

$conn.Close()
Write-Host "Done."
