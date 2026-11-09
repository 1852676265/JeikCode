# JeikCode installer for Windows — PowerShell
#
#   irm https://raw.githubusercontent.com/1852676265/JeikCode/main/scripts/install.ps1 | iex
#
# Env overrides:
#   $env:JEIKCODE_VERSION    release tag (default: latest release asset latest.json)
#   $env:JEIKCODE_PREFIX     install dir (default: $HOME\.local\bin)
#   $env:JEIKCODE_MANIFEST_URL / $env:JEIKCODE_DOWNLOAD_BASE  override update channel (optional)
#   $env:JEIKCODE_NO_PATH_UPDATE=1  do not persist PATH changes (CI/portable installs)

$ErrorActionPreference = "Stop"

$DownloadBase = if ($env:ZAP_DOWNLOAD_BASE) { $env:ZAP_DOWNLOAD_BASE.TrimEnd('/') } elseif ($env:JEIKCODE_DOWNLOAD_BASE) { $env:JEIKCODE_DOWNLOAD_BASE.TrimEnd('/') } else { "https://github.com/1852676265/JeikCode/releases/download" }
$RepoBase   = $DownloadBase
function Normalize-ReleaseTag([string]$Value) {
    if ([string]::IsNullOrWhiteSpace($Value)) { return $null }
    $Value = $Value.Trim()
    if ($Value.StartsWith("v")) { return $Value }
    return "v$Value"
}

$EffectiveVersion = if ($env:ZAP_VERSION) { $env:ZAP_VERSION } else { $env:JEIKCODE_VERSION }
$RequestedTag = Normalize-ReleaseTag $EffectiveVersion
$EffectiveManifest = if ($env:ZAP_MANIFEST_URL) { $env:ZAP_MANIFEST_URL } else { $env:JEIKCODE_MANIFEST_URL }
$ManifestUrl = if ($EffectiveManifest) {
    $custom = $EffectiveManifest.TrimEnd('/')
    if ($custom.EndsWith('.json')) { $custom } else { "$custom/latest.json" }
} elseif ($RequestedTag) {
    "https://github.com/1852676265/JeikCode/releases/download/$RequestedTag/latest.json"
} else {
    "https://github.com/1852676265/JeikCode/releases/latest/download/latest.json"
}

# --- detect platform ---
$os = "windows"
$RealArch = if ($env:PROCESSOR_ARCHITEW6432) {
    $env:PROCESSOR_ARCHITEW6432
} else {
    $env:PROCESSOR_ARCHITECTURE
}
switch ($RealArch) {
    "AMD64" { $arch = "x64" }
    "ARM64" { $arch = "arm64" }
    default {
        Write-Host "Unsupported architecture: $RealArch (supported: AMD64, ARM64)" -ForegroundColor Red
        exit 1
    }
}
$ext = ".exe"

# --- install dir ---
$Prefix = if ($env:ZAP_PREFIX) { $env:ZAP_PREFIX } elseif ($env:JEIKCODE_PREFIX) { $env:JEIKCODE_PREFIX } else { Join-Path $HOME ".local\bin" }
New-Item -ItemType Directory -Force -Path $Prefix | Out-Null

# --- resolve and validate release manifest ---
Write-Host "==> Reading release manifest ($ManifestUrl)"
try {
    $manifest = Invoke-RestMethod -Uri $ManifestUrl -TimeoutSec 10
} catch {
    throw "Could not download release manifest; refusing an unverified install. $($_.Exception.Message)"
}
$ManifestTag = Normalize-ReleaseTag ([string]$manifest.version)
if (-not $ManifestTag) {
    throw "Release manifest is missing a version."
}
if ($RequestedTag -and $ManifestTag -ne $RequestedTag) {
    throw "Requested $RequestedTag but manifest reports $ManifestTag."
}
$Version = $ManifestTag

$TargetKey = "windows-$arch"
$EntryProperty = $manifest.binaries.PSObject.Properties[$TargetKey]
if (-not $EntryProperty) {
    throw "Release manifest has no binary entry for $TargetKey."
}
$Entry = $EntryProperty.Value
$ExpectedSha = [string]$Entry.sha256
if ($ExpectedSha -notmatch '^[0-9A-Fa-f]{64}$') {
    throw "Release manifest has an invalid SHA256 for $TargetKey."
}
[long]$ExpectedSize = 0
if (-not [long]::TryParse([string]$Entry.size, [ref]$ExpectedSize) -or $ExpectedSize -le 0) {
    throw "Release manifest has an invalid size for $TargetKey."
}

# --- download ---
$TagWithV = if ($Version.StartsWith("v")) { $Version } else { "v$Version" }
$TagWithoutV = $Version.TrimStart("v")

$PrimaryTag = $TagWithV
$SecondaryTag = $TagWithoutV

$BinName = "jeikcode-${PrimaryTag}-${os}-${arch}${ext}"
$Url = "$RepoBase/$PrimaryTag/$BinName"
$Dest = Join-Path $env:TEMP $BinName

Write-Host "==> Downloading $BinName"
Write-Host "    from $Url"
try {
    Invoke-WebRequest -Uri $Url -OutFile $Dest -UseBasicParsing
} catch {
    $AltName = "jeikcode-${SecondaryTag}-${os}-${arch}${ext}"
    $AltUrl = "$RepoBase/$SecondaryTag/$AltName"
    Write-Host "==> Retrying with $AltName"
    Write-Host "    from $AltUrl"
    Invoke-WebRequest -Uri $AltUrl -OutFile $Dest -UseBasicParsing
}

# Sanity check: not an HTML 404 page
$head = [System.IO.File]::ReadAllBytes($Dest)[0..3]
$isHtml = ($head -contains 0x3C)  # '<'
if ($isHtml) {
    Write-Error "Download looks like an HTML page, not a binary. URL: $Url"
    exit 1
}

$ActualSize = (Get-Item -LiteralPath $Dest).Length
if ($ActualSize -ne $ExpectedSize) {
    Remove-Item -LiteralPath $Dest -Force -ErrorAction SilentlyContinue
    throw "Downloaded binary size mismatch (expected $ExpectedSize, got $ActualSize)."
}
$ActualSha = (Get-FileHash -LiteralPath $Dest -Algorithm SHA256).Hash
if ($ActualSha -ne $ExpectedSha) {
    Remove-Item -LiteralPath $Dest -Force -ErrorAction SilentlyContinue
    throw "Downloaded binary SHA256 mismatch; refusing installation."
}
Write-Host "==> Verified SHA256 and size for $TargetKey"

# --- install ---
$Target = Join-Path $Prefix "jeikcode$ext"
Write-Host "==> Installing to $Target"
try {
    Move-Item -Force $Dest $Target -ErrorAction Stop
} catch {
    Write-Host "Error: could not write $Target." -ForegroundColor Red
    Write-Host "       If jeikcode is already running, close it and re-run this installer." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Installed: $Target"
try { & $Target --version 2>$null } catch {}

# Provide zap.exe alias alongside jeikcode.exe
$ZapTarget = Join-Path $Prefix "zap$ext"
try {
    Copy-Item -Force $Target $ZapTarget -ErrorAction SilentlyContinue
    if (Test-Path $ZapTarget) {
        Write-Host "Created alias: $ZapTarget"
    }
} catch {}

# --- check & sync config if ~/.zap or ~/.jeikcode exists ---
$ZapHome = if ($env:ZAP_HOME) { $env:ZAP_HOME } elseif ($env:JEIKCODE_HOME) { $env:JEIKCODE_HOME } else {
    $p = Join-Path $HOME ".zap"
    if (Test-Path $p) { $p } else { Join-Path $HOME ".jeikcode" }
}
if (Test-Path $ZapHome) {
    Write-Host ""
    Write-Host "==> 检测到已有配置目录 ($ZapHome)，正在检查内置配置更新..."
    try {
        & $Target __sync_config
    } catch {
        Write-Host "    (跳过交互式配置同步：$_)"
    }
}

# --- PATH ---
$NoPathUpdate = if ($env:ZAP_NO_PATH_UPDATE) { $env:ZAP_NO_PATH_UPDATE } else { $env:JEIKCODE_NO_PATH_UPDATE }
if ($NoPathUpdate -ne "1") {
    $currentPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ($currentPath -notlike "*$Prefix*") {
        [Environment]::SetEnvironmentVariable("Path", "$Prefix;$currentPath", "User")
        Write-Host "Added $Prefix to user PATH (new shells will pick it up)."
    } else {
        Write-Host "$Prefix already on user PATH."
    }

    # Update current session PATH so zap can be used immediately
    if ($env:Path -notlike "*$Prefix*") {
        $env:Path = "$Prefix;$env:Path"
    }
}

Write-Host ""
Write-Host "To start using Zap right now, run:"
Write-Host "    zap"
Write-Host ""
Write-Host "==> Zap uses the official release update channel. To enable auto-update, add to ~/.zap/config.toml:"
Write-Host "    auto_update = true"
exit 0
