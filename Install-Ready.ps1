param([switch]$Silent)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Dist = Join-Path $Root 'dist'
$launcher = Join-Path $Root 'Start-Claude-Chinese.ps1'
$required = @(
    (Join-Path $Dist 'app.asar'),
    (Join-Path $Dist 'claude-zh-hook.dll'),
    (Join-Path $Dist 'ClaudeChineseLauncher.exe'),
    $launcher
)
if ($required | Where-Object { -not (Test-Path -LiteralPath $_) }) {
    throw '下载包不完整，缺少运行时文件。请重新下载完整发行包。'
}
$package = Get-AppxPackage Claude | Sort-Object Version -Descending | Select-Object -First 1
if (-not $package) { throw '未找到 Claude Desktop，请先安装官方版本。' }
$icon = Join-Path $package.InstallLocation 'app\claude.exe'
$desktop = [Environment]::GetFolderPath('Desktop')
$startMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
$shell = New-Object -ComObject WScript.Shell
foreach ($shortcutPath in @((Join-Path $desktop 'Claude 中文版.lnk'), (Join-Path $startMenu 'Claude 中文版.lnk'))) {
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = 'powershell.exe'
    $shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcher`""
    $shortcut.WorkingDirectory = $Root
    if (Test-Path -LiteralPath $icon) { $shortcut.IconLocation = "$icon,0" }
    $shortcut.Description = '启动官方 Claude Desktop 并自动注入简体中文语言包'
    $shortcut.Save()
}
if (-not $Silent) {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show('安装完成。请从系统托盘完全退出 Claude，然后打开桌面上的「Claude 中文版」。', 'Claude 中文语言包') | Out-Null
}
