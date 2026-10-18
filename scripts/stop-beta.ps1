[CmdletBinding(SupportsShouldProcess = $true)]
param(
    # Override only when inspecting a test process registry.
    [string]$RegistryPath
)

$ErrorActionPreference = 'Stop'
if (-not $RegistryPath) { $RegistryPath = Join-Path (Split-Path -Parent $PSScriptRoot) '.tools\beta-processes.json' }
if (-not (Test-Path -LiteralPath $RegistryPath)) {
    Write-Host 'No tracked background beta processes. For servers started in a terminal, press Ctrl+C in that terminal.'
    return
}

$tracked = Get-Content -LiteralPath $RegistryPath -Raw | ConvertFrom-Json
$refused = $false
foreach ($entry in @($tracked)) {
    $process = Get-Process -Id ([int]$entry.processId) -ErrorAction SilentlyContinue
    if (-not $process) {
        Write-Host ($entry.label + ': already stopped.')
        continue
    }
    # Windows can reuse a PID. Never stop a replacement process just because
    # it now has the number saved by an earlier beta session.
    if ($process.Path -ne $entry.executable -or
        $process.StartTime.ToUniversalTime().Ticks.ToString() -ne $entry.startedUtcTicks) {
        Write-Warning ($entry.label + ': process identity changed; left it untouched.')
        $refused = $true
        continue
    }
    if ($PSCmdlet.ShouldProcess(($entry.label + ' (PID ' + $process.Id + ')'), 'Stop background process')) {
        Stop-Process -InputObject $process -ErrorAction Stop
        Write-Host ($entry.label + ': stopped.')
    }
}
if ($refused) { exit 1 }
