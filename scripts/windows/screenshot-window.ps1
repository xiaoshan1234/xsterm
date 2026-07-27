<#
.SYNOPSIS
  Captures a screenshot of a single window (matched by title) into a PNG.

.DESCRIPTION
  Uses Win32 GetWindowRect + System.Drawing CopyFromScreen to grab
  exactly the pixels under the target window. Falls back to full-screen
  capture if no matching window appears within 5 seconds.

.PARAMETER WindowTitle
  Substring match against MainWindowTitle. Default: 'xsterm'.

.PARAMETER OutPath
  Where to write the PNG. Default: $env:TEMP\<title>-<timestamp>.png

.PARAMETER TimeoutSeconds
  How long to wait for the window to appear. Default: 5.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\windows\screenshot-window.ps1
  powershell -ExecutionPolicy Bypass -File scripts\windows\screenshot-window.ps1 -WindowTitle xsterm -OutPath C:\temp\x.png
#>
[CmdletBinding()]
param(
  [string]$WindowTitle = 'xsterm',
  [string]$OutPath = '',
  [int]$TimeoutSeconds = 5
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public class WinShot {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll", SetLastError=true)]
  public static extern bool EnumWindows(EnumProc lpEnumFunc, IntPtr lParam);
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }

  public static IntPtr FindByTitle(string titleSubstring) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, l) => {
      var sb = new StringBuilder(256);
      int len = GetWindowText(h, sb, sb.Capacity);
      if (len > 0 && sb.ToString().IndexOf(titleSubstring, StringComparison.OrdinalIgnoreCase) >= 0) {
        found = h;
        return false;
      }
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
'@

if (-not $OutPath) {
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $safe = ($WindowTitle -replace '[^a-zA-Z0-9-_]', '_')
  $OutPath = Join-Path $env:TEMP "$safe-$stamp.png"
}

function Save-Fullscreen([string]$path) {
  $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $bmp = New-Object System.Drawing.Bitmap $screen.Width, $screen.Height
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($screen.Location, [System.Drawing.Point]::Empty, $screen.Size)
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  Write-Host "Saved full-screen capture: $path"
}

$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$hWnd = [IntPtr]::Zero
while ((Get-Date) -lt $deadline) {
  $hWnd = [WinShot]::FindByTitle($WindowTitle)
  if ($hWnd -ne [IntPtr]::Zero) { break }
  Start-Sleep -Milliseconds 250
}

if ($hWnd -eq [IntPtr]::Zero) {
  Write-Warning "No window with title containing '$WindowTitle' found within $TimeoutSeconds s. Falling back to full-screen."
  Save-Fullscreen $OutPath
  exit 0
}

$rect = New-Object WinShot+RECT
[WinShot]::GetWindowRect($hWnd, [ref]$rect) | Out-Null
$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top
if ($width -le 0 -or $height -le 0) {
  Write-Warning "Window has empty rect ($width x $height). Falling back to full-screen."
  Save-Fullscreen $OutPath
  exit 0
}

Write-Host "Window handle: $hWnd  size: ${width}x${height}"
$bmp = New-Object System.Drawing.Bitmap $width, $height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($rect.Left, $rect.Top, 0, 0, (New-Object System.Drawing.Size $width, $height))
$bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Host "Saved: $OutPath"