$ErrorActionPreference = 'Stop'

$adbCommand = Get-Command adb -ErrorAction SilentlyContinue
$adbPath = if ($adbCommand) { $adbCommand.Source } else { $null }

if (-not $adbPath) {
    $sdkRoots = @($env:ANDROID_SDK_ROOT, $env:ANDROID_HOME, "$env:LOCALAPPDATA\Android\Sdk") |
        Where-Object { $_ } | Select-Object -Unique
    foreach ($sdkRoot in $sdkRoots) {
        $candidate = Join-Path $sdkRoot 'platform-tools\adb.exe'
        if (Test-Path -LiteralPath $candidate) {
            $adbPath = $candidate
            break
        }
    }
}

if (-not $adbPath) {
    Write-Error 'Android Debug Bridge (adb) was not found. Install Android SDK Platform-Tools, then add its platform-tools folder to PATH or set ANDROID_SDK_ROOT.'
    exit 1
}

$deviceOutput = @(& $adbPath devices)
if ($LASTEXITCODE -ne 0) { throw 'adb could not start. Check the Android SDK Platform-Tools installation.' }
$deviceLines = $deviceOutput | Select-Object -Skip 1 | Where-Object { $_ -match '^\S+\s+device$' }
if (-not $deviceLines) {
    Write-Host ($deviceOutput -join [Environment]::NewLine)
    Write-Error 'No authorized Android device found. Connect the phone by USB, enable USB debugging, and accept its debugging authorization prompt.'
    exit 1
}

& $adbPath reverse tcp:5173 tcp:5173
if ($LASTEXITCODE -ne 0) { throw 'Port forwarding failed. Reconnect the phone and authorize USB debugging, then retry.' }

Write-Host ''
Write-Host 'Android localhost forwarding is ready: phone localhost:5173 -> laptop localhost:5173.'
Write-Host 'Keep the USB cable connected and run `npm run dev` in another terminal.'
Write-Host 'Then run `npx evenhub qr --url http://localhost:5173` and open the QR using the Even app.'
