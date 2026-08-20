<#
.SYNOPSIS
    ARIA Mission Control — Windows PowerShell 24/7 supervisor.

.DESCRIPTION
    Keeps ARIA running 24/7 on Windows. Auto-bootstraps the DB on
    first boot, restarts on crash, rotates logs, detects crash-loops,
    and respects a 20-restart-per-hour cap.

    Equivalent to scripts/keeper.sh for Linux/macOS.

.PARAMETER Port
    HTTP port (default 3000).

.PARAMETER NodeEnv
    "development" or "production" (default development).

.PARAMETER MaxRestartsPerHour
    Cap before backoff (default 20).

.EXAMPLE
    .\keeper.ps1
    .\keeper.ps1 -NodeEnv production
    .\keeper.ps1 -Port 4000 -NodeEnv production
#>

param(
    [int]$Port = 3000,
    [string]$NodeEnv = "development",
    [int]$MaxRestartsPerHour = 20,
    [int]$MinUptimeSec = 10
)

$ErrorActionPreference = "Continue"
$AppDir = $PSScriptRoot
$LogDir = Join-Path $AppDir "logs"
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }

$StdoutLog = Join-Path $LogDir "aria-stdout.log"
$StderrLog = Join-Path $LogDir "aria-stderr.log"
$CrashLog  = Join-Path $LogDir "aria-crashes.log"

# ─── Default zero-cost env (only set if not already in .env) ────────
if (-not $env:DATABASE_URL) { $env:DATABASE_URL = "file:$AppDir\db\custom.db" }
if (-not $env:OLLAMA_HOST)  { $env:OLLAMA_HOST = "http://127.0.0.1:11434" }
if (-not $env:JARVIS_DEV_BYPASS_AUTH) { $env:JARVIS_DEV_BYPASS_AUTH = "1" }
if (-not $env:ARIA_PREFER_LOCAL_LLM)  { $env:ARIA_PREFER_LOCAL_LLM = "1" }
if (-not $env:NODE_ENV)     { $env:NODE_ENV = $NodeEnv }
if (-not $env:PORT)         { $env:PORT = $Port }

Write-Host "[keeper] ARIA 24/7 supervisor starting (mode=$NodeEnv port=$Port)" -ForegroundColor Cyan
Write-Host "[keeper] App dir: $AppDir"
Write-Host "[keeper] Logs: $LogDir"

# ─── One-time bootstrap ─────────────────────────────────────────────
$bootstrapFlag = Join-Path $AppDir "db\.bootstrap-done"
if (-not (Test-Path $bootstrapFlag)) {
    Write-Host "[keeper] first boot — running prisma db push + generate" -ForegroundColor Yellow
    $dbDir = Join-Path $AppDir "db"
    if (-not (Test-Path $dbDir)) { New-Item -ItemType Directory -Path $dbDir -Force | Out-Null }
    Push-Location $AppDir
    try {
        bunx prisma db push --accept-data-loss --skip-generate 2>&1 | Tee-Object -FilePath $StdoutLog -Append
        bunx prisma generate 2>&1 | Tee-Object -FilePath $StdoutLog -Append
        New-Item -ItemType File -Path $bootstrapFlag -Force | Out-Null
        Write-Host "[keeper] bootstrap complete" -ForegroundColor Green
    } catch {
        Write-Host "[keeper] bootstrap failed: $_" -ForegroundColor Red
    } finally { Pop-Location }
}

# ─── Log rotation (10MB) ────────────────────────────────────────────
function Rotate-Log($logPath, $maxBytes = 10MB) {
    if (Test-Path $logPath) {
        $size = (Get-Item $logPath).Length
        if ($size -gt $maxBytes) {
            $rolled = "$logPath.$(Get-Date -Format 'yyyyMMdd-HHmmss').rolled"
            Move-Item $logPath $rolled -Force
            # Compress old logs (optional — gzip if available)
            try { Compress-Archive -Path $rolled -DestinationPath "$rolled.zip" -Force; Remove-Item $rolled -Force } catch {}
            # Keep only last 5 rolled logs
            Get-ChildItem "$logPath.*.rolled.zip" | Sort-Object LastWriteTime -Descending | Select-Object -Skip 5 | Remove-Item -Force -ErrorAction SilentlyContinue
        }
    }
}

# ─── Crash-loop detection ───────────────────────────────────────────
$script:restartTimes = [System.Collections.ArrayList]::new()

function Clean-OldRestarts {
    $now = [DateTime]::UtcNow
    $cutoff = $now.AddHours(-1)
    $script:restartTimes = [System.Collections.ArrayList]@($script:restartTimes | Where-Object { $_ -gt $cutoff })
}

# ─── Choose start command ───────────────────────────────────────────
function Get-StartCommand {
    if ($NodeEnv -eq "production") {
        $standalone = Join-Path $AppDir ".next\standalone\server.js"
        if (-not (Test-Path $standalone)) {
            Write-Host "[keeper] production mode but no standalone build — running bun run build first" -ForegroundColor Yellow
            Push-Location $AppDir
            bun run build 2>&1 | Tee-Object -FilePath $StdoutLog -Append
            Pop-Location
        }
        return @{ File = "bun"; Args = @("$AppDir\.next\standalone\server.js") }
    } else {
        return @{ File = "bun"; Args = @("run", "dev", "--", "-p", "$Port") }
    }
}

# ─── Main supervisor loop ───────────────────────────────────────────
$running = $true
while ($running) {
    Rotate-Log $StdoutLog
    Rotate-Log $StderrLog

    $startTs = Get-Date
    $cmd = Get-StartCommand
    Write-Host "[keeper] $(Get-Date -Format o) starting: $($cmd.File) $($cmd.Args -join ' ')" -ForegroundColor Cyan

    # Start the process with redirected output
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $cmd.File
    $psi.Arguments = ($cmd.Args | ForEach-Object { if ($_ -match '\s') { "`"$_`"" } else { $_ } }) -join " "
    $psi.WorkingDirectory = $AppDir
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true

    # Set env vars
    foreach ($key in @("NODE_ENV", "PORT", "DATABASE_URL", "OLLAMA_HOST", "JARVIS_DEV_BYPASS_AUTH", "ARIA_PREFER_LOCAL_LLM")) {
        $val = (Get-Item -Path "Env:$key" -ErrorAction SilentlyContinue).Value
        if ($val) { $psi.EnvironmentVariables[$key] = $val }
    }

    $proc = New-Object System.Diagnostics.Process
    $proc.StartInfo = $psi

    # Async output redirect to log files
    $outScript = { if ($EventArgs.Data) { Add-Content -Path $using:StdoutLog -Value $EventArgs.Data } }
    $errScript = { if ($EventArgs.Data) { Add-Content -Path $using:StderrLog -Value $EventArgs.Data } }
    Register-ObjectEvent -InputObject $proc -EventName OutputDataReceived -Action $outScript | Out-Null
    Register-ObjectEvent -InputObject $proc -EventName ErrorDataReceived -Action $errScript | Out-Null

    $proc.Start() | Out-Null
    $proc.BeginOutputReadLine()
    $proc.BeginErrorReadLine()
    $proc.WaitForExit()
    $exitCode = $proc.ExitCode

    $endTs = Get-Date
    $uptime = ($endTs - $startTs).TotalSeconds

    $crashEntry = "$(Get-Date -Format o) exit=$exitCode uptime=$([math]::Round($uptime,1))s"
    Add-Content -Path $CrashLog -Value $crashEntry
    Write-Host "[keeper] $crashEntry" -ForegroundColor $(if ($exitCode -eq 0) { "Green" } else { "Yellow" })

    # Boot-loop detection
    if ($uptime -lt $MinUptimeSec) {
        Write-Host "[keeper] crash within $([math]::Round($uptime,1))s — backing off 30s" -ForegroundColor Red
        Start-Sleep -Seconds 30
    }

    # Rate-limit restarts
    $script:restartTimes.Add($endTs) | Out-Null
    Clean-OldRestarts
    if ($script:restartTimes.Count -ge $MaxRestartsPerHour) {
        Write-Host "[keeper] $MaxRestartsPerHour restarts in the last hour — backing off 5 min" -ForegroundColor Red
        Start-Sleep -Seconds 300
    }

    # Brief pause before restart
    Start-Sleep -Seconds 2
}
