<#
  Weekly LOCAL roof-permit refresh — runs the feeds that need local files/state
  the GitHub Actions cron can't reach:
    - Tampa (Hillsborough): needs data/inbox/hillsborough/parcel_4_public.dbf
      for the STRAP->FOLIO map. Re-applies CivicData 2023->present.
    - Hillsborough HCPA scraper: stateful checkpoint queue (data/temp), grinds
      a 20k-parcel chunk per run through the ~444k backlog, then maintenance.
  Reads creds from .env.local (scripts use dotenv). Logs to logs/local-refresh-*.log.

  Run once now:   pwsh scripts/local-refresh.ps1
  Schedule weekly (Mondays 03:00) — run this ONCE in an elevated PowerShell:
    $action  = New-ScheduledTaskAction -Execute "pwsh.exe" `
      -Argument "-File `"$PWD\scripts\local-refresh.ps1`"" -WorkingDirectory $PWD
    $trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At 3am
    $set     = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun
    Register-ScheduledTask -TaskName "RoofSonar weekly permit refresh" `
      -Action $action -Trigger $trigger -Settings $set
  (-StartWhenAvailable runs the task as soon as possible if the PC was off at 3am.)
#>
$ErrorActionPreference = "Continue"
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo
New-Item -ItemType Directory -Force "logs" | Out-Null
$log = "logs/local-refresh-$(Get-Date -Format yyyyMMdd-HHmmss).log"

function Step($name, [ScriptBlock]$cmd) {
  "=== $name :: $(Get-Date -Format o) ===" | Tee-Object -FilePath $log -Append
  & $cmd 2>&1 | Tee-Object -FilePath $log -Append
}

Step "Tampa CivicData (--recent, 90d window)" { npx tsx scripts/ingest-tampa-permits.ts --recent --since 90d }
Step "Hillsborough HCPA scrape (20k chunk)" { npx tsx scripts/scrape-hillsborough-permits.ts --limit 20000 }

"=== done :: $(Get-Date -Format o) ===" | Tee-Object -FilePath $log -Append
