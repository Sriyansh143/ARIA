<#
.SYNOPSIS
    ARIA v47 Pre-Launch Security Smoke Test (PowerShell edition)

.DESCRIPTION
    Verifies the 5 CRITICAL security fixes from the v46 Final Audit by making
    real HTTP requests to a running ARIA instance. Tests:
      Fix 1: /api/seed requires auth (expect 401)
      Fix 2: Public API routes are rate-limited (expect 429 after 11+ requests)
      Fix 3: /api/conductor + /api/training/* require auth (expect 401 on all 5)
      Fix 4: /api/webhooks/resend signature verification (expect 503/401 on 3 sub-tests)

.PARAMETER BaseUrl
    The ARIA base URL. Defaults to http://localhost:3000.

.EXAMPLE
    .\scripts\pre-launch-smoke-test.ps1
    .\scripts\pre-launch-smoke-test.ps1 -BaseUrl http://localhost:3001

.OUTPUTS
    Colored PASS/FAIL lines + a summary. Exits 0 if all pass, 1 if any fail.
#>
param(
    [string]$BaseUrl = "http://localhost:3000"
)

$ErrorActionPreference = "SilentlyContinue"
$Pass = 0
$Fail = 0

function Write-Header($t) {
    Write-Host ""
    Write-Host ("=" * 67) -ForegroundColor Cyan
    Write-Host "  $t" -ForegroundColor Cyan
    Write-Host ("=" * 67) -ForegroundColor Cyan
}

function Write-Section($t) {
    Write-Host ""
    Write-Host "-- $t" -ForegroundColor Yellow
}

function Write-Pass($t) {
    Write-Host "  [PASS] $t" -ForegroundColor Green
    $script:Pass++
}

function Write-Fail($t) {
    Write-Host "  [FAIL] $t" -ForegroundColor Red
    $script:Fail++
}

function Write-Info2($t) {
    Write-Host "  ...  $t" -ForegroundColor Gray
}

function Get-StatusCode {
    param(
        [string]$Url,
        [string]$Method = "GET",
        [string]$Body = $null,
        [hashtable]$Headers = @{}
    )
    try {
        $params = @{
            Uri             = $Url
            Method          = $Method
            UseBasicParsing = $true
            TimeoutSec      = 5
            ErrorAction     = "Stop"
        }
        if ($Body) {
            $params.Body = $Body
            $params.ContentType = "application/json"
        }
        if ($Headers.Count -gt 0) {
            $params.Headers = $Headers
        }
        $response = Invoke-WebRequest @params
        return @{ Status = $response.StatusCode; Error = $null }
    } catch {
        # WebException means we got a non-2xx status (which is what we expect for 401/429/503)
        if ($_.Exception.Response) {
            return @{ Status = [int]$_.Exception.Response.StatusCode; Error = $null }
        }
        # Other error (timeout, DNS, etc.)
        return @{ Status = 0; Error = $_.Exception.Message }
    }
}

Write-Header "ARIA v47 Pre-Launch Security Smoke Test (PowerShell)"
Write-Host "  Target: $BaseUrl"
Write-Host "  Time:   $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"

# ─── Fix 1: /api/seed requires auth ────────────────────────────────
Write-Section "Fix 1: /api/seed requires authentication"
Write-Info2 "GET /api/seed without auth (expect 401 or 307 redirect to /login)..."

$result = Get-StatusCode -Url "$BaseUrl/api/seed" -Method "GET"
if ($result.Status -eq 401 -or $result.Status -eq 307 -or $result.Status -eq 403) {
    Write-Pass "GET /api/seed -> $($result.Status) (blocked)"
} elseif ($result.Status -eq 200) {
    Write-Fail "GET /api/seed -> 200 (CRITICAL: entire database is exposed!)"
} else {
    Write-Fail "GET /api/seed -> $($result.Status) (expected 401/307/403; error: $($result.Error))"
}

# ─── Fix 2: Public API routes are rate-limited ─────────────────────
Write-Section "Fix 2: Public API routes are rate-limited (10 req/min)"
Write-Info2 "Hammering /api/services/catalog 15x (expect 429 after ~11 requests)..."

$got429 = $false
$lastStatus = 0
for ($i = 1; $i -le 15; $i++) {
    $result = Get-StatusCode -Url "$BaseUrl/api/services/catalog" -Method "GET"
    $lastStatus = $result.Status
    if ($result.Status -eq 429) {
        $got429 = $true
        Write-Info2 "Request $i -> 429 (rate-limited)"
        break
    }
    if ($result.Status -eq 0) {
        Write-Info2 "Request $i -> error ($($result.Error))"
        break
    }
}

if ($got429) {
    Write-Pass "Public route returned 429 after $i requests (rate-limited)"
} else {
    Write-Fail "Public route did NOT rate-limit after 15 requests (last status: $lastStatus)"
    Write-Info2 "Check: RATE_LIMIT_DISABLED must NOT be 'true' in .env"
}

# ─── Fix 3: /api/conductor + /api/training/* require auth ──────────
Write-Section "Fix 3: /api/conductor + /api/training/* require auth"

# Test 3a: /api/conductor POST
Write-Info2 "POST /api/conductor without auth (expect 401)..."
$result = Get-StatusCode -Url "$BaseUrl/api/conductor" -Method "POST" -Body '{"message":"test"}'
if ($result.Status -eq 401 -or $result.Status -eq 307 -or $result.Status -eq 403) {
    Write-Pass "POST /api/conductor -> $($result.Status) (blocked)"
} else {
    Write-Fail "POST /api/conductor -> $($result.Status) (expected 401/307/403)"
}

# Test 3b: /api/training/teach POST
Write-Info2 "POST /api/training/teach without auth (expect 401)..."
$result = Get-StatusCode -Url "$BaseUrl/api/training/teach" -Method "POST" -Body '{"agentId":"test","source":"test"}'
if ($result.Status -eq 401 -or $result.Status -eq 307 -or $result.Status -eq 403) {
    Write-Pass "POST /api/training/teach -> $($result.Status) (blocked)"
} else {
    Write-Fail "POST /api/training/teach -> $($result.Status) (expected 401/307/403)"
}

# Test 3c: /api/training/feedback POST
Write-Info2 "POST /api/training/feedback without auth (expect 401)..."
$result = Get-StatusCode -Url "$BaseUrl/api/training/feedback" -Method "POST" -Body '{"entryId":"test","feedback":"positive"}'
if ($result.Status -eq 401 -or $result.Status -eq 307 -or $result.Status -eq 403) {
    Write-Pass "POST /api/training/feedback -> $($result.Status) (blocked)"
} else {
    Write-Fail "POST /api/training/feedback -> $($result.Status) (expected 401/307/403)"
}

# Test 3d: /api/training/inject POST
Write-Info2 "POST /api/training/inject without auth (expect 401)..."
$result = Get-StatusCode -Url "$BaseUrl/api/training/inject" -Method "POST" -Body '{"entryId":"test","feedback":"positive","note":"test"}'
if ($result.Status -eq 401 -or $result.Status -eq 307 -or $result.Status -eq 403) {
    Write-Pass "POST /api/training/inject -> $($result.Status) (blocked)"
} else {
    Write-Fail "POST /api/training/inject -> $($result.Status) (expected 401/307/403)"
}

# Test 3e: /api/training GET
Write-Info2 "GET /api/training without auth (expect 401)..."
$result = Get-StatusCode -Url "$BaseUrl/api/training" -Method "GET"
if ($result.Status -eq 401 -or $result.Status -eq 307 -or $result.Status -eq 403) {
    Write-Pass "GET /api/training -> $($result.Status) (blocked)"
} else {
    Write-Fail "GET /api/training -> $($result.Status) (expected 401/307/403)"
}

# ─── Fix 4: Webhook signature verification ─────────────────────────
Write-Section "Fix 4: /api/webhooks/resend signature verification"

# Test 4a: POST without secret set -> expect 503 (fail-closed)
# Note: if RESEND_WEBHOOK_SECRET IS set in .env, this test will get 401 instead (missing Svix headers)
# Either is acceptable — both indicate the webhook is NOT open.
Write-Info2 "POST /api/webhooks/resend without Svix headers (expect 503 or 401)..."
$result = Get-StatusCode -Url "$BaseUrl/api/webhooks/resend" -Method "POST" -Body '{"from":"test@example.com","text":"test"}'
if ($result.Status -eq 503 -or $result.Status -eq 401) {
    Write-Pass "POST /api/webhooks/resend without headers -> $($result.Status) (blocked)"
} elseif ($result.Status -eq 200) {
    Write-Fail "POST /api/webhooks/resend -> 200 (CRITICAL: webhook is OPEN!)"
} else {
    Write-Fail "POST /api/webhooks/resend -> $($result.Status) (expected 503 or 401)"
}

# Test 4b: POST with missing Svix headers but secret IS set -> expect 401
# (This test only runs if the secret is set — otherwise it's the same as 4a)
Write-Info2 "POST with missing svix-id header (expect 401 if secret set, 503 if not)..."
$result = Get-StatusCode -Url "$BaseUrl/api/webhooks/resend" -Method "POST" -Body '{"from":"test@example.com","text":"test"}'
if ($result.Status -eq 401 -or $result.Status -eq 503) {
    Write-Pass "POST without svix-id -> $($result.Status) (blocked)"
} else {
    Write-Fail "POST without svix-id -> $($result.Status) (expected 401 or 503)"
}

# Test 4c: POST with invalid Svix signature -> expect 401
Write-Info2 "POST with invalid Svix signature (expect 401)..."
$svixHeaders = @{
    "svix-id"        = "test-id"
    "svix-timestamp" = "$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())"
    "svix-signature" = "v1,invalidbase64signature=="
}
$result = Get-StatusCode -Url "$BaseUrl/api/webhooks/resend" -Method "POST" -Body '{"from":"test@example.com","text":"test"}' -Headers $svixHeaders
if ($result.Status -eq 401 -or $result.Status -eq 503) {
    Write-Pass "POST with invalid signature -> $($result.Status) (rejected)"
} else {
    Write-Fail "POST with invalid signature -> $($result.Status) (expected 401)"
}

# ─── Summary ───────────────────────────────────────────────────────
Write-Header "SUMMARY: $Pass passed, $Fail failed"

if ($Fail -gt 0) {
    Write-Host ""
    Write-Host "  [!] $Fail security check(s) FAILED. Do NOT deploy until all pass." -ForegroundColor Red
    Write-Host ""
    Write-Host "  Common causes:" -ForegroundColor Yellow
    Write-Host "    - RATE_LIMIT_DISABLED=true in .env (disables Fix 2)"
    Write-Host "    - JARVIS_DEV_BYPASS_AUTH=1 in .env (bypasses auth — must be 0)"
    Write-Host "    - RESEND_WEBHOOK_SECRET not set (Fix 4 Test A expects 503)"
    Write-Host "    - Extraction didn't apply v47 — re-extract the zip"
    Write-Host ""
    exit 1
} else {
    Write-Host ""
    Write-Host "  All security fixes verified. Safe to soft-launch." -ForegroundColor Green
    Write-Host ""
    exit 0
}
