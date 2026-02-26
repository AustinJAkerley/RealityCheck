# RealityCheck — Windows PowerShell build helper
# Usage:  .\scripts\build.ps1 [all | core | chrome | edge | firefox | safari | test | clean]
# Requires: Node.js 18+ and npm 9+ on PATH
#
# Run from the repo root:
#   .\scripts\build.ps1          # defaults to "all"
#   .\scripts\build.ps1 test     # run unit tests
#   .\scripts\build.ps1 chrome   # build core + Chrome extension only
#   .\scripts\build.ps1 safari   # build core + Safari extension only
#   .\scripts\build.ps1 clean    # remove all dist folders

param(
    [string]$Target = "all"
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot

function Invoke-Install {
    Write-Host "Installing dependencies..." -ForegroundColor Cyan
    Push-Location $RepoRoot
    try {
        npm install
        if ($LASTEXITCODE -ne 0) { throw "npm install failed (exit $LASTEXITCODE)" }
    } finally {
        Pop-Location
    }
}

function Invoke-CoreBuild {
    Write-Host "Building @reality-check/core..." -ForegroundColor Cyan
    Push-Location "$RepoRoot\packages\core"
    try {
        npm run build
        if ($LASTEXITCODE -ne 0) { throw "Core build failed (exit $LASTEXITCODE)" }
    } finally {
        Pop-Location
    }
}

function Invoke-ExtensionBuild([string]$ext) {
    Write-Host "Building $ext extension..." -ForegroundColor Cyan
    node "$RepoRoot\extensions\$ext\build.js"
    if ($LASTEXITCODE -ne 0) { throw "$ext extension build failed (exit $LASTEXITCODE)" }
}

function Invoke-Clean {
    Write-Host "Removing dist folders..." -ForegroundColor Yellow
    $dirs = @(
        "$RepoRoot\packages\core\dist",
        "$RepoRoot\extensions\chrome\dist",
        "$RepoRoot\extensions\edge\dist",
        "$RepoRoot\extensions\firefox\dist",
        "$RepoRoot\extensions\safari\dist"
    )
    foreach ($d in $dirs) {
        if (Test-Path $d) {
            Remove-Item -Recurse -Force $d
            Write-Host "  Removed $d"
        }
    }
    Write-Host "Clean complete." -ForegroundColor Green
}

function Invoke-Tests {
    Write-Host "Running unit tests..." -ForegroundColor Cyan
    Push-Location "$RepoRoot\packages\core"
    try {
        npm test
        if ($LASTEXITCODE -ne 0) { throw "Tests failed (exit $LASTEXITCODE)" }
    } finally {
        Pop-Location
    }
}

switch ($Target.ToLower()) {
    "all" {
        Invoke-Install
        Invoke-CoreBuild
        Invoke-ExtensionBuild "chrome"
        Invoke-ExtensionBuild "edge"
        Invoke-ExtensionBuild "firefox"
        Invoke-ExtensionBuild "safari"
        Write-Host "`nAll extensions built successfully." -ForegroundColor Green
    }
    "core" {
        Invoke-Install
        Invoke-CoreBuild
        Write-Host "Core built successfully." -ForegroundColor Green
    }
    "chrome" {
        Invoke-Install
        Invoke-CoreBuild
        Invoke-ExtensionBuild "chrome"
        Write-Host "Chrome extension built successfully." -ForegroundColor Green
    }
    "edge" {
        Invoke-Install
        Invoke-CoreBuild
        Invoke-ExtensionBuild "edge"
        Write-Host "Edge extension built successfully." -ForegroundColor Green
    }
    "firefox" {
        Invoke-Install
        Invoke-CoreBuild
        Invoke-ExtensionBuild "firefox"
        Write-Host "Firefox extension built successfully." -ForegroundColor Green
    }
    "safari" {
        Invoke-Install
        Invoke-CoreBuild
        Invoke-ExtensionBuild "safari"
        Write-Host "Safari extension built successfully." -ForegroundColor Green
    }
    "test" {
        Invoke-Install
        Invoke-Tests
    }
    "clean" {
        Invoke-Clean
    }
    default {
        Write-Error "Unknown target: $Target"
        Write-Host "Usage: .\scripts\build.ps1 [all | core | chrome | edge | firefox | safari | test | clean]"
        exit 1
    }
}
