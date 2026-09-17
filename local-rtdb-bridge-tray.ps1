Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$apiProcess = $null
$frontProcess = $null

function Start-BridgeProcess {
  param (
    [string]$Arguments
  )

  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = "cmd.exe"
  $startInfo.Arguments = "/c cd /d `"$projectDir`" && $Arguments"
  $startInfo.WorkingDirectory = $projectDir
  $startInfo.CreateNoWindow = $true
  $startInfo.UseShellExecute = $false
  $startInfo.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden

  return [System.Diagnostics.Process]::Start($startInfo)
}

function Stop-Bridge {
  Get-NetTCPConnection -LocalPort 4174,5173 -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique |
    ForEach-Object {
      try {
        Stop-Process -Id $_ -Force -ErrorAction Stop
      } catch {
      }
    }
}

Stop-Bridge
$apiProcess = Start-BridgeProcess "npm run api"
$frontProcess = Start-BridgeProcess "npm run dev -- --host 127.0.0.1"

Start-Sleep -Seconds 3
Start-Process "http://127.0.0.1:5173"

$notifyIcon = New-Object System.Windows.Forms.NotifyIcon
$notifyIcon.Icon = [System.Drawing.SystemIcons]::Application
$notifyIcon.Text = "oldPC RTDB Bridge"
$notifyIcon.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$openItem = New-Object System.Windows.Forms.ToolStripMenuItem
$openItem.Text = "Open oldPC"
$openItem.Add_Click({
  Start-Process "http://127.0.0.1:5173"
})

$stopItem = New-Object System.Windows.Forms.ToolStripMenuItem
$stopItem.Text = "Exit"
$stopItem.Add_Click({
  $notifyIcon.Visible = $false
  Stop-Bridge
  [System.Windows.Forms.Application]::Exit()
})

$menu.Items.Add($openItem) | Out-Null
$menu.Items.Add($stopItem) | Out-Null
$notifyIcon.ContextMenuStrip = $menu

$notifyIcon.ShowBalloonTip(3000, "oldPC RTDB Bridge", "Running in the system tray.", [System.Windows.Forms.ToolTipIcon]::Info)

[System.Windows.Forms.Application]::Run()
