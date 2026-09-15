$desktop = [Environment]::GetFolderPath('Desktop')
$startMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
Remove-Item -LiteralPath (Join-Path $desktop 'Claude 中文版.lnk') -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath (Join-Path $startMenu 'Claude 中文版.lnk') -Force -ErrorAction SilentlyContinue
Write-Host 'Claude 中文语言包快捷方式已移除；官方 Claude Desktop 未被修改。'
