Add-Type -AssemblyName System.Drawing

$workspace = Split-Path -Parent $PSScriptRoot
$svgPath = Join-Path $workspace "assets/zap-logo.svg"
$masterPng = Join-Path $workspace "assets/zap-1024.png"
$htmlPath = Join-Path $workspace "scripts/render-temp.html"
$iconsDir = Join-Path $workspace "desktop/src-tauri/icons"
$webuiPublic = Join-Path $workspace "webui/public"

$edgeExe = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
if (-not (Test-Path $edgeExe)) {
    Write-Error "Edge not found at: $edgeExe"
    exit 1
}

$svgContent = Get-Content -Path $svgPath -Raw -Encoding UTF8
$htmlContent = @"
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    width: 1024px;
    height: 1024px;
    background: transparent;
    overflow: hidden;
  }
  svg {
    width: 1024px;
    height: 1024px;
    display: block;
  }
</style>
</head>
<body>
$svgContent
</body>
</html>
"@

Set-Content -Path $htmlPath -Value $htmlContent -Encoding UTF8
$htmlUrl = "file:///" + $htmlPath.Replace("\", "/")

Write-Host "1. Rendering SVG to master 1024x1024 PNG via Headless Edge..."
$argsList = @(
    "--headless=new",
    "--disable-gpu",
    "--force-device-scale-factor=1",
    "--window-size=1024,1024",
    "--default-background-color=00000000",
    "--screenshot=$masterPng",
    $htmlUrl
)
Start-Process -FilePath $edgeExe -ArgumentList $argsList -Wait -NoNewWindow

if (Test-Path $htmlPath) { Remove-Item $htmlPath }

if (-not (Test-Path $masterPng)) {
    Write-Error "Failed to generate master PNG: $masterPng"
    exit 1
}

$masterSize = (Get-Item $masterPng).Length
Write-Host "Master PNG generated: $masterPng ($masterSize bytes)"

$masterBmp = [System.Drawing.Bitmap]::FromFile($masterPng)

function Resize-Image($src, $w, $h, $destPath) {
    $destBmp = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($destBmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)
    $g.DrawImage($src, 0, 0, $w, $h)
    $g.Dispose()

    $destDir = Split-Path -Parent $destPath
    if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Path $destDir -Force | Out-Null }
    
    $destBmp.Save($destPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $destBmp.Dispose()
    Write-Host "  -> Generated $(Split-Path -Leaf $destPath) ($w x $h)"
}

Write-Host "2. Resizing to desktop and web target PNGs..."
Resize-Image $masterBmp 512 512 (Join-Path $iconsDir "icon.png")
Resize-Image $masterBmp 256 256 (Join-Path $iconsDir "128x128@2x.png")
Resize-Image $masterBmp 128 128 (Join-Path $iconsDir "128x128.png")
Resize-Image $masterBmp 64 64 (Join-Path $iconsDir "64x64.png")
Resize-Image $masterBmp 32 32 (Join-Path $iconsDir "32x32.png")
Resize-Image $masterBmp 30 30 (Join-Path $iconsDir "Square30x30Logo.png")
Resize-Image $masterBmp 44 44 (Join-Path $iconsDir "Square44x44Logo.png")
Resize-Image $masterBmp 71 71 (Join-Path $iconsDir "Square71x71Logo.png")
Resize-Image $masterBmp 89 89 (Join-Path $iconsDir "Square89x89Logo.png")
Resize-Image $masterBmp 107 107 (Join-Path $iconsDir "Square107x107Logo.png")
Resize-Image $masterBmp 142 142 (Join-Path $iconsDir "Square142x142Logo.png")
Resize-Image $masterBmp 150 150 (Join-Path $iconsDir "Square150x150Logo.png")
Resize-Image $masterBmp 284 284 (Join-Path $iconsDir "Square284x284Logo.png")
Resize-Image $masterBmp 310 310 (Join-Path $iconsDir "Square310x310Logo.png")
Resize-Image $masterBmp 50 50 (Join-Path $iconsDir "StoreLogo.png")
Resize-Image $masterBmp 64 64 (Join-Path $webuiPublic "favicon.png")
Resize-Image $masterBmp 180 180 (Join-Path $webuiPublic "apple-touch-icon.png")

Write-Host "3. Generating Windows multi-resolution icon.ico..."
$icoSizes = @(16, 24, 32, 48, 64, 128, 256)
$icoStreams = @()

foreach ($s in $icoSizes) {
    $tempBmp = New-Object System.Drawing.Bitmap($s, $s, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($tempBmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)
    $g.DrawImage($masterBmp, 0, 0, $s, $s)
    $g.Dispose()

    $ms = New-Object System.IO.MemoryStream
    $tempBmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $tempBmp.Dispose()

    $icoStreams += @{
        Size = $s
        Bytes = $ms.ToArray()
    }
    $ms.Dispose()
}

$masterBmp.Dispose()

$icoFile = Join-Path $iconsDir "icon.ico"
$fs = [System.IO.File]::Create($icoFile)
$bw = New-Object System.IO.BinaryWriter($fs)

# ICONDIR header (6 bytes)
$bw.Write([UInt16]0) # Reserved
$bw.Write([UInt16]1) # 1 = ICO
$bw.Write([UInt16]$icoStreams.Count)

$offset = 6 + ($icoStreams.Count * 16)

# Directory entries (16 bytes each)
foreach ($item in $icoStreams) {
    $wByte = if ($item.Size -ge 256) { [byte]0 } else { [byte]$item.Size }
    $hByte = if ($item.Size -ge 256) { [byte]0 } else { [byte]$item.Size }
    $bw.Write($wByte)
    $bw.Write($hByte)
    $bw.Write([byte]0) # Color palette count
    $bw.Write([byte]0) # Reserved
    $bw.Write([UInt16]1) # Color planes
    $bw.Write([UInt16]32) # Bits per pixel
    $bw.Write([UInt32]$item.Bytes.Length)
    $bw.Write([UInt32]$offset)
    $offset += $item.Bytes.Length
}

# Image data blocks
foreach ($item in $icoStreams) {
    $bw.Write($item.Bytes)
}

$bw.Flush()
$bw.Close()
$fs.Close()

$icoLen = (Get-Item $icoFile).Length
Write-Host "Windows icon.ico generated: $icoFile ($icoLen bytes)"

# Sync Windows .ico across CLI and root assets
$cliIco = Join-Path $workspace "crates/jeikcode-cli/assets/zap.ico"
$cliLegacyIco = Join-Path $workspace "crates/jeikcode-cli/assets/jeikcode.ico"
$rootZapIco = Join-Path $workspace "assets/zap.ico"
$rootLegacyIco = Join-Path $workspace "assets/jeikcode.ico"
$docsIco = Join-Path $workspace "docs-site/public/favicon.ico"

Copy-Item $icoFile $cliIco -Force
Copy-Item $icoFile $cliLegacyIco -Force
Copy-Item $icoFile $rootZapIco -Force
Copy-Item $icoFile $rootLegacyIco -Force
Copy-Item $icoFile $docsIco -Force

Write-Host "All Zap desktop, CLI, and Web icons successfully refreshed!"
