<#
  Download the HCPA public parcel + lat/lon files via the ASP.NET WebForms
  postback grid on downloads.hcpafl.org (no direct URLs). HCparcel_4_public =
  parcel attributes (folio, situs, owner, DOR code, year built, heated area,
  muni); LatLon_Table = folio -> lat/lon. Joined by folio downstream.

    pwsh scripts/fetch-hillsborough-files.ps1
#>
$ErrorActionPreference = "Stop"
$ua   = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Safari/537.36"
$base = "https://downloads.hcpafl.org/"
$dest = "data/inbox/hillsborough"
New-Item -ItemType Directory -Force $dest | Out-Null

$targets = @{
  "HCparcel_4_public.zip" = 'grdFiles$ctl00$ctl14$ctl00'
  "LatLon_Table.zip"      = 'grdFiles$ctl00$ctl18$ctl00'
}

function Get-Hidden($html, $name) {
  $m = [regex]::Match($html, ('name="' + [regex]::Escape($name) + '"[^>]*?value="([^"]*)"'))
  if (-not $m.Success) { $m = [regex]::Match($html, ('id="' + [regex]::Escape($name) + '"[^>]*?value="([^"]*)"')) }
  return $m.Groups[1].Value
}

foreach ($file in $targets.Keys) {
  Write-Host "Downloading $file (postback $($targets[$file]))..."
  # fresh GET for a valid viewstate each time
  $page = Invoke-WebRequest -Uri $base -UserAgent $ua -SessionVariable sess -TimeoutSec 60
  $html = $page.Content
  $body = @{
    "__EVENTTARGET"        = $targets[$file]
    "__EVENTARGUMENT"      = ""
    "__VIEWSTATE"          = (Get-Hidden $html "__VIEWSTATE")
    "__VIEWSTATEGENERATOR" = (Get-Hidden $html "__VIEWSTATEGENERATOR")
    "__EVENTVALIDATION"    = (Get-Hidden $html "__EVENTVALIDATION")
  }
  $out = Join-Path $dest $file
  Invoke-WebRequest -Uri $base -Method Post -Body $body -WebSession $sess -UserAgent $ua -OutFile $out -TimeoutSec 600
  $sz = [math]::Round((Get-Item $out).Length / 1MB, 1)
  $sig = -join ([System.IO.File]::ReadAllBytes($out)[0..1] | ForEach-Object { [char]$_ })
  Write-Host "  saved $file : $sz MB, sig=$sig $(if ($sig -eq 'PK') { '(valid zip)' } else { '(NOT a zip!)' })"
}
Write-Host "Done."
