param([int]$DurationSeconds = 0, [int]$IntervalSeconds = 2)
$ErrorActionPreference = 'Stop'
if ($DurationSeconds -lt 0 -or $DurationSeconds -gt 600 -or $IntervalSeconds -lt 1) { throw 'Use a duration of 0-600 seconds and an interval of at least 1 second.' }
$adbCommand = Get-Command adb -ErrorAction SilentlyContinue
$adbPath = if ($adbCommand) { $adbCommand.Source } else { 'C:\platform-tools\adb.exe' }
if (-not (Test-Path -LiteralPath $adbPath)) { throw 'Install Android Platform-Tools and add adb to PATH first.' }
function Read-Adb {
  param([string[]]$Arguments)
  $lines = @(& $adbPath @Arguments 2>&1)
  if ($LASTEXITCODE -ne 0) { throw "adb failed: $($lines -join ' ')" }
  return $lines
}
$androidVersion = (Read-Adb -Arguments @('shell','getprop','ro.build.version.release')) -join ''
$appVersion = @((Read-Adb -Arguments @('shell','dumpsys','package','com.even.sg')) | Select-String 'versionName=|versionCode=' | ForEach-Object { $_.ToString().Trim() })
$samples = New-Object 'System.Collections.Generic.List[object]'
$started = [DateTime]::UtcNow
do {
  $samples.Add(@{
    at = [DateTime]::UtcNow.ToString('o')
    power = @((Read-Adb -Arguments @('shell','dumpsys','power')) | Select-String 'mWakefulness=|mIsPowered=|mStayOn=|Display Power:|com.even.sg' | ForEach-Object { $_.ToString().Trim() })
    evenServices = @((Read-Adb -Arguments @('shell','dumpsys','activity','services','com.even.sg')) | Select-String 'ServiceRecord|isForeground=|foregroundId=|foregroundServiceType=|startRequested=' | ForEach-Object { $_.ToString().Trim() })
  })
  Write-Host "Captured device status $($samples.Count). Lock/unlock the phone manually; this script changes no device settings."
  if (([DateTime]::UtcNow - $started).TotalSeconds -ge $DurationSeconds) { break }
  Start-Sleep -Seconds $IntervalSeconds
} while ($true)
$report = @{ schemaVersion=1; startedAt=$started.ToString('o'); androidVersion=$androidVersion; evenVersion=$appVersion; samples=$samples.ToArray() }
$outputDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../recordings'))
[IO.Directory]::CreateDirectory($outputDirectory) | Out-Null
$filename = Join-Path $outputDirectory ("screen-lock-device-" + [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH-mm-ss') + '.json')
[IO.File]::WriteAllText($filename, ($report | ConvertTo-Json -Depth 8))
Write-Host "Saved $filename"
