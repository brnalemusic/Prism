$ErrorActionPreference = "Stop"

function Write-Header {
    Write-Host ""
    Write-Host "  +-------------------------------------+" -ForegroundColor DarkCyan
    Write-Host "  |         Prism Version Sync           |" -ForegroundColor DarkCyan
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

# --- Header ---
Write-Header

# --- Read version.txt ---
$versionFile = "version.txt"
if (-not (Test-Path $versionFile)) {
    Write-Step "X" "version.txt not found!" Red
    exit 1
}
$newVersion = (Get-Content $versionFile -Raw).Trim()
if ($newVersion -match "^\s*$") {
    Write-Step "X" "version.txt is empty!" Red
    exit 1
}
Write-Step "*" "Reading version.txt..." DarkYellow
Write-Host "     > $newVersion" -ForegroundColor Cyan

# --- Read current package.json ---
$pkgPath = "package.json"
$pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json
$oldVersion = $pkg.version

Write-Step "*" "Reading package.json..." DarkYellow
Write-Host "     > $oldVersion" -ForegroundColor Gray

Write-Separator

# --- Check README.md ---
$readmePath = "README.md"
$readmeUpdated = $false
if (Test-Path $readmePath) {
    $readmeContent = [System.IO.File]::ReadAllText((Get-Item $readmePath).FullName, [System.Text.Encoding]::UTF8)
    $readmeRegex = 'https://img\.shields\.io/badge/version-([0-9]+\.[0-9]+\.[0-9]+[a-zA-Z0-9\.\-]*)-38bdf8'
    if ($readmeContent -match $readmeRegex) {
        $currentReadmeVersion = $Matches[1]
        if ($currentReadmeVersion -ne $newVersion) {
            $readmeContent = $readmeContent -replace $readmeRegex, "https://img.shields.io/badge/version-$newVersion-38bdf8"
            [System.IO.File]::WriteAllText((Get-Item $readmePath).FullName, $readmeContent, (New-Object System.Text.UTF8Encoding $false))
            $readmeUpdated = $true
        }
    }
}

# --- Check package-lock.json ---
$lockPath = "package-lock.json"
$lockUpdated = $false
if (Test-Path $lockPath) {
    $lockContent = [System.IO.File]::ReadAllText((Get-Item $lockPath).FullName, [System.Text.Encoding]::UTF8)
    $lockRegex = '("name":\s*"prism",\s*"version":\s*")[^"]+(")'
    if ($lockContent -match $lockRegex) {
        $currentLockVersion = ($lockContent | Select-String -Pattern $lockRegex).Matches[0].Groups[0].Value
        $lockContent = $lockContent -replace $lockRegex, "`$1$newVersion`$2"
        [System.IO.File]::WriteAllText((Get-Item $lockPath).FullName, $lockContent, (New-Object System.Text.UTF8Encoding $false))
        $lockUpdated = $true
    }
}

# --- Check if sync needed ---
if ($oldVersion -eq $newVersion -and -not $readmeUpdated -and -not $lockUpdated) {
    Write-Step "OK" "Already up to date ($newVersion)!" Green
    Write-Host ""
    exit 0
}

# --- Show transition ---
Write-Step ">" "Version change:" White
Write-Host ""
Write-Host "     " -NoNewline
Write-Host $oldVersion -ForegroundColor Red -NoNewline
Write-Host " -> " -ForegroundColor DarkGray -NoNewline
Write-Host $newVersion -ForegroundColor Green
Write-Host ""

# --- Update package.json ---
$pkg.version = $newVersion
$json = $pkg | ConvertTo-Json -Depth 10
[System.IO.File]::WriteAllText((Get-Item $pkgPath).FullName, $json, (New-Object System.Text.UTF8Encoding $false))

Write-Step "OK" "Updated package.json" Green
if ($readmeUpdated) {
    Write-Step "OK" "Updated README.md" Green
}
if ($lockUpdated) {
    Write-Step "OK" "Updated package-lock.json" Green
}

# --- Collect changed files ---
$changedFiles = @()

# Save old ErrorActionPreference to avoid native command error on git stderr output
$oldEAP = $ErrorActionPreference
$ErrorActionPreference = "SilentlyContinue"

# Check git diff
$gitDiff = git diff --name-only 2>$null
if ($gitDiff) {
    foreach ($file in $gitDiff) {
        $changedFiles += $file
    }
}

# Check untracked version-related files
$untracked = git ls-files --others --exclude-standard 2>$null
if ($untracked) {
    foreach ($file in $untracked) {
        if ($file -eq "version.txt") {
            $changedFiles += $file
        }
    }
}

$ErrorActionPreference = $oldEAP

# --- Show changed files ---
if ($changedFiles.Count -gt 0) {
    Write-Host ""
    Write-Step "[]" "Files changed:" White
    foreach ($file in ($changedFiles | Sort-Object -Unique)) {
        if ($file -eq "package.json") {
            Write-Host "     OK $file" -ForegroundColor Green
        } elseif ($file -eq "README.md") {
            Write-Host "     OK $file" -ForegroundColor Green
        } elseif ($file -eq "package-lock.json") {
            Write-Host "     OK $file" -ForegroundColor Green
        } elseif ($file -eq "version.txt") {
            Write-Host "     ~  $file" -ForegroundColor Yellow
        } else {
            Write-Host "     *  $file" -ForegroundColor Gray
        }
    }
}

Write-Separator
Write-Step "OK" "Sync complete!" Green
Write-Host ""
