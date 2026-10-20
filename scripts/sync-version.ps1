$ErrorActionPreference = "Stop"

function Write-Header {
    Write-Host ""
    Write-Host "  +-------------------------------------+" -ForegroundColor DarkCyan
    Write-Host "  |      Prism Version Sync (D+M)       |" -ForegroundColor DarkCyan
    Write-Host "  +-------------------------------------+" -ForegroundColor DarkCyan
    Write-Host ""
}

function Write-Step {
    param([string]$Icon, [string]$Text, [string]$Color = "White")
    Write-Host "  $Icon " -ForegroundColor $Color -NoNewline
    Write-Host $Text
}

function Write-Separator {
    Write-Host "  --------------------------------------" -ForegroundColor DarkGray
}

Write-Header

$desktopVersionFile = "version.txt"
$mobileVersionFile = "version_m.txt"

foreach ($file in @($desktopVersionFile, $mobileVersionFile)) {
    if (-not (Test-Path $file)) {
        Write-Step "X" "$file not found! Both version files are required." Red
        exit 1
    }
    $value = (Get-Content $file -Raw).Trim()
    if ($value -match "^\s*$") {
        Write-Step "X" "$file is empty!" Red
        exit 1
    }
    Write-Step "*" "Reading $file..." DarkYellow
    Write-Host "     > $value" -ForegroundColor Cyan
}

Write-Separator

# A single Node script owns the rules for both apps: equal versions are left
# untouched, different versions are written to package files and app.json.
node scripts/sync-versions.mjs
if ($LASTEXITCODE -ne 0) {
    Write-Step "X" "Version sync failed." Red
    exit 1
}

Write-Separator

$changedFiles = @()
$oldEAP = $ErrorActionPreference
$ErrorActionPreference = "SilentlyContinue"

$gitDiff = git diff --name-only 2>$null
if ($gitDiff) {
    foreach ($file in $gitDiff) { $changedFiles += $file }
}

$untracked = git ls-files --others --exclude-standard 2>$null
if ($untracked) {
    foreach ($file in $untracked) {
        if ($file -eq "version.txt" -or $file -eq "version_m.txt") { $changedFiles += $file }
    }
}

$ErrorActionPreference = $oldEAP

if ($changedFiles.Count -gt 0) {
    Write-Host ""
    Write-Step "[]" "Files changed:" White
    foreach ($file in ($changedFiles | Sort-Object -Unique)) {
        Write-Host "     *  $file" -ForegroundColor Gray
    }
}

Write-Separator
Write-Step "OK" "Sync complete! Commit the changes and push a release tag." Green
Write-Host ""
