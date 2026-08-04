# BreakFree v2.1 Smoke Test — boots the server if it isn't already running,
# exercises the key endpoints, then shuts down only what it started.
Write-Host "🧪 BreakFree v2.1 Smoke Test" -ForegroundColor Cyan

$serverDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

# Run a node one-liner that prints OK or FAIL. Uses a temp .cjs inside the
# server dir so quoting survives PowerShell 5.1 and require.resolve works.
function Invoke-NodeCheck {
    param([string]$Code)
    $tmp = Join-Path $serverDir (".smoke-" + [guid]::NewGuid().ToString("N") + ".cjs")
    try {
        [System.IO.File]::WriteAllText($tmp, $Code, (New-Object System.Text.UTF8Encoding $false))
        Push-Location $serverDir
        try { $out = (& node $tmp 2>&1) } finally { Pop-Location }
        return ($out -join "`n") -match "OK"
    } finally {
        Remove-Item -LiteralPath $tmp -ErrorAction SilentlyContinue
    }
}

$base = "http://localhost:4000"
$serverPid = $null

# Boot the server unless /healthz already answers.
$alreadyUp = $false
try { $alreadyUp = [bool](Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 "$base/healthz" -ErrorAction SilentlyContinue) } catch { $alreadyUp = $false }

if (-not $alreadyUp) {
    Write-Host "Starting server for smoke test..." -ForegroundColor Yellow
    Push-Location $serverDir
    $serverPid = Start-Process -FilePath "node" -ArgumentList "index.js" -PassThru -NoNewWindow -RedirectStandardOutput (Join-Path $env:TEMP "bf-smoke-out.log") -RedirectStandardError (Join-Path $env:TEMP "bf-smoke-err.log")
    Pop-Location
    $up = $false
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Milliseconds 500
        try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 "$base/healthz" -ErrorAction SilentlyContinue; if ($r) { $up = $true; break } } catch { }
    }
    if (-not $up) {
        Write-Host "❌ Server failed to boot. stderr:" -ForegroundColor Red
        if (Test-Path (Join-Path $env:TEMP "bf-smoke-err.log")) { Get-Content (Join-Path $env:TEMP "bf-smoke-err.log") -Tail 30 }
        exit 1
    }
    Write-Host "Server is up (PID $($serverPid.Id))." -ForegroundColor Green
}

$tests = @(
    @{n="Server /healthz";        c="curl.exe -s $base/healthz | Select-String 'ok'"},
    @{n="Self-check healthy";     c="curl.exe -s $base/api/self-check | Select-String 'healthy'"},
    @{n="CSRF token returns";     c="curl.exe -s $base/api/csrf-token | Select-String 'csrfToken'"},
    @{n="Secret guard passes";    c="npm run prestart 2>&1 | Select-String 'Secrets validated'"},
    @{n="DB indexes >=5";         c=""}
)

# DB index check via better-sqlite3 (node:sqlite is not available in Node 24).
if (Test-Path (Join-Path $serverDir "data\breakfree.db")) {
    $tests[4].c = "Invoke-NodeCheck `"const D=require('better-sqlite3'); const db=new D(process.cwd() + '\\data\\breakfree.db'); const c=db.prepare('SELECT COUNT(*) c FROM sqlite_master WHERE type=''index'' AND name LIKE ''idx_%''').get().c; db.close(); console.log(c>=5?'OK':'FAIL');`""
} else {
    $tests[4].c = "Write-Output 'FAIL (db file missing)'"
}

$fail = 0
foreach ($t in $tests) {
    $ok = [bool](Invoke-Expression $t.c -ErrorAction SilentlyContinue)
    if (-not $ok) { $fail += 1 }
    if ($ok) { Write-Host "✅ $($t.n)" -ForegroundColor Green } else { Write-Host "❌ $($t.n)" -ForegroundColor Red }
}

if ($serverPid) {
    Write-Host "Stopping smoke-test server (PID $($serverPid.Id))..." -ForegroundColor Yellow
    Stop-Process -Id $serverPid.Id -Force -ErrorAction SilentlyContinue
    Remove-Item (Join-Path $env:TEMP "bf-smoke-out.log"), (Join-Path $env:TEMP "bf-smoke-err.log") -ErrorAction SilentlyContinue
}

if ($fail) { Write-Host "⚠️ $fail FAILED — FIX BEFORE DEPLOY" -ForegroundColor Red; exit 1 }
Write-Host "🎉 ALL PASSED — SAFE TO DEPLOY" -ForegroundColor Green
