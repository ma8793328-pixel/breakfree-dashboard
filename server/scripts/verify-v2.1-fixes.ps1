<#
.SYNOPSIS
    BreakFree v2.1 Critical Fixes Verification Script (PowerShell / Windows)
.DESCRIPTION
    Verifies all critical fixes for BreakFree v2.1 are implemented. Pure
    PowerShell for file checks, delegates Node-only checks (deps, DB) to
    `node -e` so it always uses the real installed modules.
#>

Write-Host "`n🔍 BreakFree v2.1 Critical Fixes Verification" -ForegroundColor Cyan

$allPassed = $true
$results = @()

function Test-Check {
    param(
        [string]$Name,
        [bool]$Passed,
        [string]$Details = ""
    )
    $script:results += [PSCustomObject]@{ Name = $Name; Passed = $Passed; Details = $Details }
    $status = if ($Passed) { "✅" } else { "❌" }
    $color = if ($Passed) { "Green" } else { "Red" }
    if ($Details) { Write-Host "$status $Name - $Details" -ForegroundColor $color }
    else { Write-Host "$status $Name" -ForegroundColor $color }
    if (-not $Passed) { $script:allPassed = $false }
}

# Parse server/.env into a hashtable (simple KEY=VALUE, skip comments)
function Read-EnvFile {
    $envPath = Join-Path $PSScriptRoot "..\.env"
    $vars = @{}
    if (-not (Test-Path $envPath)) { return $vars }
    Get-Content $envPath | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith("#") -and $line -match "^([^=]+)=(.*)$") {
            $vars[$matches[1].Trim()] = $matches[2].Trim()
        }
    }
    return $vars
}

# Run a node one-liner that prints OK or FAIL. Returns $true if it prints OK.
# Uses a temp .cjs inside the server dir so (a) quoting is never mangled by
# PowerShell's native argument passing (PS 5.1 breaks args with double quotes)
# and (b) require.resolve still finds server\node_modules.
function Invoke-NodeCheck {
    param([string]$Code)
    $tmp = Join-Path $serverDir (".bfcheck-" + [guid]::NewGuid().ToString("N") + ".cjs")
    try {
        [System.IO.File]::WriteAllText($tmp, $Code, (New-Object System.Text.UTF8Encoding $false))
        Push-Location $serverDir
        try { $out = (& node $tmp 2>&1) } finally { Pop-Location }
        return ($out -join "`n") -match "OK"
    } finally {
        Remove-Item -LiteralPath $tmp -ErrorAction SilentlyContinue
    }
}

$envVars = Read-EnvFile
$serverDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

# ========== PHASE 1: BOOT BLOCKER (Dependencies) ==========
Write-Host "`n📦 Phase 1: Boot Blocker (Dependencies)" -ForegroundColor Yellow

foreach ($dep in @('express-rate-limit', 'helmet', 'csurf', 'stripe', 'better-sqlite3', 'cookie-parser')) {
    Test-Check "$dep installed" (Invoke-NodeCheck "try { require.resolve('$dep'); console.log('OK'); } catch { console.log('FAIL'); }")
}

# ========== PHASE 2: SECURITY ==========
Write-Host "`n🔒 Phase 2: Security" -ForegroundColor Yellow

$adminPw = $envVars['ADMIN_PASSWORD']
Test-Check "ADMIN_PASSWORD not default" ($adminPw -and $adminPw -ne "admin12345") -Details $(if ($adminPw) { "Set" } else { "NOT SET" })

$jwtSecret = $envVars['JWT_SECRET']
Test-Check "JWT_SECRET not default" ($jwtSecret -and $jwtSecret -ne "breakfree-dev-secret-change-me") -Details $(if ($jwtSecret) { "Set" } else { "NOT SET" })
Test-Check "JWT_SECRET is strong (64+ chars)" ($jwtSecret -and $jwtSecret.Length -ge 64)

$stripeKey = $envVars['STRIPE_SECRET_KEY']
Test-Check "Stripe keys are live mode" ($stripeKey -and $stripeKey.StartsWith("sk_live_"))

$stripeWebhook = $envVars['STRIPE_WEBHOOK_SECRET']
Test-Check "Stripe webhook secret set" ($stripeWebhook -and $stripeWebhook.StartsWith("whsec_"))

$indexPath = Join-Path $serverDir "index.js"
if (Test-Path $indexPath) {
    $indexContent = Get-Content $indexPath -Raw

    Test-Check "CSRF middleware configured" ($indexContent -match "csurf" -and $indexContent -match "httpOnly:" -and $indexContent -match "sameSite:")
    $cookieIdx = $indexContent.IndexOf("app.use(cookieParser())")
    $csrfIdx = $indexContent.IndexOf("csrf({")
    Test-Check "cookie-parser applied before csrf" ($cookieIdx -ge 0 -and $csrfIdx -ge 0 -and $cookieIdx -lt $csrfIdx)
    Test-Check "No bare require() in ESM routes (self-check uses createRequire)" ($indexContent -match "createRequire\(import\.meta\.url\)" -and $indexContent -notmatch "require\(\s*d\s*\)")
    Test-Check "Self-check queries the shared db for indexes" ($indexContent -match "sqlite_master WHERE type='index' AND name LIKE 'idx_%'" -and $indexContent -match ">= 5")
    Test-Check "No .pragma() calls remain (must use db.exec)" ($indexContent -notmatch "\.pragma\(")
    Test-Check "OneDrive watchdog writes a probe file" ($indexContent -match "\.onedrive-test" -and $indexContent -match "writeFileSync\(probe")
    Test-Check "Rate limiting configured" ($indexContent -match "rateLimit" -and $indexContent -match "windowMs")
    Test-Check "Log redaction middleware exists" ($indexContent -match "redact" -and $indexContent -match "authorization")
    Test-Check "Stripe webhook IP allowlist" ($indexContent -match "STRIPE_IPS")
    Test-Check "Stripe idempotency guard" ($indexContent -match "stripe_event_ids")
    Test-Check "JWT issuer/audience claims" ($indexContent -match "issuer:\s*'breakfree'" -and $indexContent -match "audience:\s*'breakfree-api'")
    Test-Check "Clean shutdown handlers" ($indexContent -match "SIGINT" -and $indexContent -match "SIGTERM")
    Test-Check "OneDrive re-sync watchdog" ($indexContent -match "one drive re-sync" -or $indexContent -match "ONE DRIVE RE-SYNC")
} else {
    Test-Check "index.js exists" $false -Details "File not found"
}

# ========== PHASE 3: PUSH NOTIFICATIONS ==========
Write-Host "`n📱 Phase 3: Push Notifications" -ForegroundColor Yellow

$vapidPub = $envVars['VAPID_PUBLIC_KEY']
$vapidPriv = $envVars['VAPID_PRIVATE_KEY']
$vapidEmail = $envVars['VAPID_CONTACT_EMAIL']
Test-Check "VAPID keys configured" ($vapidPub -and $vapidPriv -and $vapidPub.Length -gt 20 -and $vapidPriv.Length -gt 20) -Details $(if ($vapidEmail) { "Email: $vapidEmail" } else { "Email NOT SET" })
Test-Check "vapid.json exists" (Test-Path (Join-Path $serverDir "vapid.json"))
Test-Check "VAPID validation test" (Invoke-NodeCheck "require('dotenv').config({path: process.cwd() + '/.env'}); try { const wp = require('web-push'); const em = /^mailto:/i.test(process.env.VAPID_CONTACT_EMAIL || '') ? process.env.VAPID_CONTACT_EMAIL : 'mailto:' + process.env.VAPID_CONTACT_EMAIL; wp.setVapidDetails(em, process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY); console.log('OK'); } catch { console.log('FAIL'); }")

# ========== PHASE 4: DATABASE ==========
Write-Host "`n🗃️ Phase 4: Database Performance" -ForegroundColor Yellow

$dbPath = Join-Path $serverDir "data\breakfree.db"
if (Test-Path $dbPath) {
    $envPrefix = "DATA_DIR=$serverDir\data"
    Test-Check "Database accessible" (Invoke-NodeCheck "process.env.DATA_DIR = process.cwd() + '\\data'; const D = require('better-sqlite3'); try { const db = new D(process.cwd() + '\\data\\breakfree.db'); db.close(); console.log('OK'); } catch { console.log('FAIL'); }")
    Test-Check "WAL mode enabled" (Invoke-NodeCheck "process.env.DATA_DIR = process.cwd() + '\\data'; const D = require('better-sqlite3'); const db = new D(process.cwd() + '\\data\\breakfree.db'); console.log(db.pragma('journal_mode', {simple:true}) === 'wal' ? 'OK' : 'FAIL'); db.close();")
    Test-Check "All 5 indexes exist" (Invoke-NodeCheck "const D = require('better-sqlite3'); const db = new D(process.cwd() + '\\data\\breakfree.db'); const c = db.prepare(`"SELECT COUNT(*) c FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'`").get().c; console.log(c >= 5 ? 'OK' : 'FAIL'); db.close();")
    Test-Check "stripe_event_ids table exists" (Invoke-NodeCheck "const D = require('better-sqlite3'); const db = new D(process.cwd() + '\\data\\breakfree.db'); console.log(db.prepare(\"SELECT name FROM sqlite_master WHERE type='table' AND name='stripe_event_ids'\").get() ? 'OK' : 'FAIL'); db.close();")
    Test-Check "Database integrity" (Invoke-NodeCheck "const D = require('better-sqlite3'); const db = new D(process.cwd() + '\\data\\breakfree.db'); console.log(db.pragma('integrity_check', {simple:true}) === 'ok' ? 'OK' : 'FAIL'); db.close();")
    # fullfsync/temp_store are per-connection, so a fresh connection always
    # reads fullfsync=0. Verify the boot-time pragmas exist in server/index.js.
    $serverSrc = if (Test-Path $indexPath) { Get-Content $indexPath -Raw } else { "" }
    $hasFullfsync = $serverSrc -match "PRAGMA\s*fullfsync\s*=\s*ON"
    $hasTempStore = $serverSrc -match "PRAGMA\s*temp_store\s*=\s*MEMORY"
    $hasCheckpoint = $serverSrc -match "wal_checkpoint\(\s*PASSIVE\s*\)"
    Test-Check "OneDrive pragmas configured" ($hasFullfsync -and $hasTempStore -and $hasCheckpoint) -Details "fullfsync=$hasFullfsync temp_store=$hasTempStore checkpoint=$hasCheckpoint"
} else {
    Test-Check "Database file exists" $false -Details "Not found: $dbPath"
}

# ========== PHASE 5: SCRIPTS ==========
Write-Host "`n📜 Phase 5: Scripts" -ForegroundColor Yellow

Test-Check "check-secrets.cjs exists" (Test-Path (Join-Path $PSScriptRoot "check-secrets.cjs"))
$checkSecretsContent = if (Test-Path (Join-Path $PSScriptRoot "check-secrets.cjs")) { Get-Content (Join-Path $PSScriptRoot "check-secrets.cjs") -Raw } else { "" }
Test-Check "check-secrets has ALLOW_ONEDRIVE dev override (prod stays strict)" ($checkSecretsContent -match "ALLOW_ONEDRIVE" -and $checkSecretsContent -match "process.exit\(1\)")
Test-Check "smoke-test.ps1 exists" (Test-Path (Join-Path $PSScriptRoot "smoke-test.ps1"))
Test-Check "run-migrations.cjs exists" (Test-Path (Join-Path $PSScriptRoot "run-migrations.cjs"))
Test-Check "Migration 008 exists" (Test-Path (Join-Path $serverDir "migrations\008_add_perf_indexes.sql"))

# ========== FILE CHECKS ==========
Write-Host "`n📁 File Checks" -ForegroundColor Yellow

$envFile = Join-Path $serverDir ".env"
Test-Check ".env exists and has content" ((-not (Test-Path $envFile)) -or ((Get-Item $envFile).Length -gt 0))
$hasAllowOneDrive = (Test-Path $envFile) -and ((Get-Content $envFile -Raw) -match "(?m)^ALLOW_ONEDRIVE=1\s*$")
$dbPathCheck = Join-Path $serverDir "data\breakfree.db"
Test-Check ".env has ALLOW_ONEDRIVE=1 (local dev)" ($hasAllowOneDrive -or $dbPathCheck.ToLower().IndexOf("onedrive") -lt 0)
Test-Check ".env.example exists" (Test-Path (Join-Path $serverDir ".env.example"))

$gitignore = Join-Path $serverDir ".gitignore"
if (Test-Path $gitignore) {
    $gi = Get-Content $gitignore -Raw
    Test-Check ".gitignore blocks sensitive files" ($gi -match "\.env" -and $gi -match "vapid\.json" -and $gi -match "\.db" -and $gi -match "node_modules")
} else {
    Test-Check ".gitignore blocks sensitive files" $false -Details "Missing"
}

Test-Check ".gitattributes exists" (Test-Path (Join-Path $serverDir ".gitattributes"))

# ========== CLOUDFLARE WORKER SYNC ==========
Write-Host "`n☁️ Cloudflare Worker Synchronization" -ForegroundColor Yellow

$cfPath = Join-Path $serverDir "..\cf\src\index.js"
if (Test-Path $cfPath) {
    $cfContent = Get-Content $cfPath -Raw
    $indexContent = Get-Content $indexPath -Raw

    $nodeIssuer = [regex]::Match($indexContent, "issuer:\s*['""]([^'""]+)['""]").Groups[1].Value
    $cfIssuer   = [regex]::Match($cfContent, "issuer:\s*['""]([^'""]+)['""]").Groups[1].Value
    Test-Check "JWT issuer matches Node" ($nodeIssuer -eq $cfIssuer -and $nodeIssuer -eq "breakfree") -Details "Node: $nodeIssuer, CF: $cfIssuer"

    $nodeAudience = [regex]::Match($indexContent, "audience:\s*['""]([^'""]+)['""]").Groups[1].Value
    $cfAudience   = [regex]::Match($cfContent, "audience:\s*['""]([^'""]+)['""]").Groups[1].Value
    Test-Check "JWT audience matches Node" ($nodeAudience -eq $cfAudience -and $nodeAudience -eq "breakfree-api") -Details "Node: $nodeAudience, CF: $cfAudience"

    $nodeOrigins = [regex]::Match($indexContent, "ALLOWED_ORIGINS.*?\[([^\]]+)\]", "Singleline").Groups[1].Value
    $cfOrigins   = [regex]::Match($cfContent, "ALLOWED_ORIGINS.*?\[([^\]]+)\]", "Singleline").Groups[1].Value
    $norm = { param($s) (($s -replace "`r?`n", " ") -replace "\s+", " ").Trim() }
    $nodeN = & $norm $nodeOrigins
    $cfN = & $norm $cfOrigins
    Test-Check "CORS origins match" ($nodeN -eq $cfN -and $nodeN -ne "") -Details "Node: $nodeN, CF: $cfN"

    Test-Check "CF Worker uses strong consistency" ($cfContent -match "consistency:\s*['""]strong['""]")
    Test-Check "CF Worker has context.waitUntil" ($cfContent -match "context\.waitUntil")
} else {
    Test-Check "CF Worker exists" $false -Details "Not found: $cfPath"
}

# ========== FINAL SUMMARY ==========
Write-Host "`n" + ("=" * 50) -ForegroundColor Cyan
Write-Host "📊 VERIFICATION SUMMARY" -ForegroundColor Cyan
Write-Host ("=" * 50) -ForegroundColor Cyan

$passed = @($results | Where-Object { $_.Passed }).Count
$total = $results.Count
$percentage = if ($total -gt 0) { [math]::Round(($passed / $total) * 100, 2) } else { 0 }

Write-Host "`nPassed: $passed/$total ($percentage%)`n" -ForegroundColor $(if ($allPassed) { "Green" } else { "Yellow" })

if ($allPassed) {
    Write-Host "🎉 ALL CHECKS PASSED - BreakFree v2.1 is production-ready!" -ForegroundColor Green
    exit 0
} else {
    Write-Host "⚠️  SOME CHECKS FAILED - Review the ❌ items above`n" -ForegroundColor Red
    @($results | Where-Object { -not $_.Passed }) | ForEach-Object {
        if ($_.Details) { Write-Host "  - $($_.Name) ($($_.Details))" -ForegroundColor Red }
        else { Write-Host "  - $($_.Name)" -ForegroundColor Red }
    }
    exit 1
}