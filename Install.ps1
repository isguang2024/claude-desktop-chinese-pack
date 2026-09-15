param([switch]$Silent)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$desktop = [Environment]::GetFolderPath('Desktop')
$startMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
$launcher = Join-Path $Root 'Start-Claude-Chinese.ps1'
$icon = (Get-AppxPackage Claude | Sort-Object Version -Descending | Select-Object -First 1).InstallLocation + '\app\claude.exe'

if (-not (Test-Path $icon)) { throw '未找到 Claude Desktop，请先安装官方版本。' }
if (-not (Test-Path (Join-Path $Root 'translations.generated.json'))) { throw '缺少生成的中文词典。' }
& (Join-Path $Root 'Build-LanguagePack.ps1')

$shell = New-Object -ComObject WScript.Shell
foreach ($shortcutPath in @((Join-Path $desktop 'Claude 中文版.lnk'), (Join-Path $startMenu 'Claude 中文版.lnk'))) {
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = 'powershell.exe'
    $shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcher`""
    $shortcut.WorkingDirectory = $Root
    $shortcut.IconLocation = "$icon,0"
    $shortcut.Description = '启动官方 Claude Desktop 并自动注入简体中文语言包'
    $shortcut.Save()
}

if (-not $Silent) {
    Add-Type -AssemblyName PresentationFramework
    $message = "安装完成。`n`n请先从系统托盘完全退出 Claude，然后打开桌面上的「Claude 中文版」。`n按 Ctrl+Shift+L 可临时切换中英文。"
    [System.Windows.MessageBox]::Show($message, 'Claude 中文语言包') | Out-Null
}
