Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'
$root = 'C:\Sintayehu Nexus'
$src = [System.Drawing.Image]::FromFile("$root\apps\web\public\brand\nexus-logo.png")
Write-Output ("source: " + $src.Width + "x" + $src.Height)

function Save-Resized($img, $size, $out, [double]$scale = 1.0) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)
  $inner = [int]($size * $scale)
  $off = [int](($size - $inner) / 2)
  $g.DrawImage($img, (New-Object System.Drawing.Rectangle($off, $off, $inner, $inner)))
  $dir = Split-Path $out -Parent
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}

$web = "$root\apps\web\public\icons"
$and = "$root\assets\brand\android"

foreach ($s in @(16, 24, 32, 48, 64, 128, 180, 192, 256, 512)) { Save-Resized $src $s "$web\icon-$s.png" }
foreach ($pair in @(@(48,'mdpi'),@(72,'hdpi'),@(96,'xhdpi'),@(144,'xxhdpi'),@(192,'xxxhdpi'))) {
  Save-Resized $src $pair[0] "$and\legacy\ic_launcher_$($pair[1]).png"
}
Save-Resized $src 432 "$and\adaptive\ic_launcher_foreground.png" 0.62
Save-Resized $src 512 "$and\adaptive\ic_launcher_foreground_512.png" 0.62
$bg = New-Object System.Drawing.Bitmap(432, 432)
$g2 = [System.Drawing.Graphics]::FromImage($bg)
$g2.Clear([System.Drawing.Color]::FromArgb(1, 4, 13))
$bg.Save("$and\adaptive\ic_launcher_background.png", [System.Drawing.Imaging.ImageFormat]::Png)
$g2.Dispose(); $bg.Dispose()
$src.Dispose()
Get-ChildItem -Recurse $web, $and | ForEach-Object { $_.FullName.Replace($root, '') + '  ' + $_.Length }
