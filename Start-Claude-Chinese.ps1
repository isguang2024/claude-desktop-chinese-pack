$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Dist = Join-Path $Root 'dist'
$package = Get-AppxPackage Claude | Sort-Object Version -Descending | Select-Object -First 1
if (-not $package) { throw '未找到 Claude Desktop。' }
$exe = Join-Path $package.InstallLocation 'app\claude.exe'
$desktopRunning = Get-CimInstance Win32_Process -Filter "Name='claude.exe'" -ErrorAction SilentlyContinue | Where-Object {
    $_.ExecutablePath -and [IO.Path]::GetFullPath($_.ExecutablePath) -eq [IO.Path]::GetFullPath($exe)
}
if ($desktopRunning) {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show('Claude 已在运行。请从系统托盘完全退出 Claude，再使用「Claude 中文版」启动。', 'Claude 中文语言包') | Out-Null
    exit 2
}
foreach ($artifact in @('ClaudeChineseLauncher.exe', 'claude-zh-hook.dll')) {
    $target = Join-Path $Dist $artifact
    $pending = "$target.pending"
    if (Test-Path $pending) { Move-Item $pending $target -Force }
}
$versionFile = Join-Path $Dist 'claude-version.txt'
$builtVersion = if (Test-Path $versionFile) { (Get-Content $versionFile).Trim() } else { '' }
if ($builtVersion -ne [string]$package.Version) { & (Join-Path $Root 'Build-LanguagePack.ps1') }
& (Join-Path $Dist 'ClaudeChineseLauncher.exe') $exe (Join-Path $Dist 'claude-zh-hook.dll') (Join-Path $Dist 'app.asar') (Join-Path $Dist 'i18n')
