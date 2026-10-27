$ErrorActionPreference = 'Stop'

$csc = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { throw "csc.exe not found at $csc" }

$bin = Join-Path $PSScriptRoot 'bin'
New-Item -ItemType Directory -Force -Path $bin | Out-Null

& $csc /nologo /target:exe /platform:anycpu /out:"$bin\Spike.exe" "$PSScriptRoot\Spike.cs" /r:System.dll
if ($LASTEXITCODE -ne 0) { throw "csc failed with exit code $LASTEXITCODE" }

Write-Output "BUILD_OK $bin\Spike.exe"
