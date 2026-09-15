$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Dist = Join-Path $Root 'dist'
$Work = Join-Path $env:TEMP 'ClaudeDesktopChinesePack-build'
$package = Get-AppxPackage Claude | Sort-Object Version -Descending | Select-Object -First 1
if (-not $package) { throw '未找到 Claude Desktop。' }
$resources = Join-Path $package.InstallLocation 'app\resources'
$asar = Join-Path $resources 'app.asar'
$unpacked = Join-Path $Work 'app'
$i18n = Join-Path $Dist 'i18n'
New-Item -ItemType Directory -Force -Path $Dist, $i18n | Out-Null
if (Test-Path $Work) { Remove-Item -LiteralPath $Work -Recurse -Force }
New-Item -ItemType Directory -Force -Path $unpacked | Out-Null
Get-ChildItem -LiteralPath $resources -Filter '*.json' | Copy-Item -Destination $i18n -Force
$english = Get-Content (Join-Path $resources 'en-US.json') -Raw | ConvertFrom-Json -AsHashtable
$generated = Get-Content (Join-Path $Root 'translations.generated.json') -Raw | ConvertFrom-Json -AsHashtable
$manual = Get-Content (Join-Path $Root 'translations.manual.json') -Raw | ConvertFrom-Json -AsHashtable
$desktopCommunity = if (Test-Path (Join-Path $Root 'desktop-zh-CN.json')) { Get-Content (Join-Path $Root 'desktop-zh-CN.json') -Raw | ConvertFrom-Json -AsHashtable } else { @{} }
$chinese = [ordered]@{}
foreach ($entry in $english.GetEnumerator()) {
    $translated = if ($manual.ContainsKey($entry.Value)) { $manual[$entry.Value] } elseif ($desktopCommunity.ContainsKey($entry.Key) -and $desktopCommunity[$entry.Key] -ne $entry.Value) { $desktopCommunity[$entry.Key] } elseif ($generated.ContainsKey($entry.Value)) { $generated[$entry.Value] } else { $entry.Value }
    $chinese[$entry.Key] = $translated
}
$chinese | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (Join-Path $i18n 'zh-CN.json') -Encoding utf8
$frontend = Join-Path $Dist 'frontend-zh-CN.json'
if (-not (Test-Path $frontend)) {
    throw '缺少完整前端中文词典 dist\\frontend-zh-CN.json，请先运行 tools\\frontend_translation_server.py 完成合并翻译。'
}
npx --yes @electron/asar extract $asar $unpacked
$old = 'function k5e(){return o.app.isPackaged?process.resourcesPath:n.default.resolve(__dirname,"..","..","resources","i18n")}'
$new = 'function k5e(){return process.env.CLAUDE_ZH_I18N_PATH||(o.app.isPackaged?process.resourcesPath:n.default.resolve(__dirname,"..","..","resources","i18n"))}'
$mainChunk = Get-ChildItem (Join-Path $unpacked '.vite\build') -Filter '*.js' -File | Where-Object { [IO.File]::ReadAllText($_.FullName).Contains($old) } | Select-Object -First 1 -ExpandProperty FullName
if (-not $mainChunk) { throw '当前 Claude 版本的语言加载代码已变化，需要更新适配。' }
$chunkText = [IO.File]::ReadAllText($mainChunk)
[IO.File]::WriteAllText($mainChunk, $chunkText.Replace($old, $new), [Text.UTF8Encoding]::new($false))
$frontendEnglish = Get-Content (Join-Path $resources 'ion-dist\i18n\en-US.json') -Raw | ConvertFrom-Json -AsHashtable
$frontendChinese = Get-Content $frontend -Raw | ConvertFrom-Json -AsHashtable
$dictionary = @{}
foreach ($key in $frontendEnglish.Keys) {
    if ($frontendChinese.ContainsKey($key) -and $frontendChinese[$key] -ne $frontendEnglish[$key]) { $dictionary[$frontendEnglish[$key]] = $frontendChinese[$key] }
}
foreach ($key in $generated.Keys) { $dictionary[$key] = $generated[$key] }
foreach ($key in $manual.Keys) { $dictionary[$key] = $manual[$key] }
$payload = [IO.File]::ReadAllText((Join-Path $Root 'payload.js')).Replace('__CLAUDE_ZH_DICTIONARY__', ($dictionary | ConvertTo-Json -Compress -Depth 20))
# Keep the generated renderer payload beside app.asar as well.  The main process
# uses this copy to cover WebContentsView/remote pages (for example Claude.ai's
# usage and analytics pages) that do not execute mainView.js.
$payloadRuntime = Join-Path $Dist 'payload-runtime.js'
[IO.File]::WriteAllText($payloadRuntime, $payload, [Text.UTF8Encoding]::new($false))
$preload = Join-Path $unpacked '.vite\build\mainView.js'
[IO.File]::AppendAllText($preload, "`n;" + $payload + "`n", [Text.UTF8Encoding]::new($false))
# Install the same payload in every Electron webContents.  Claude Desktop uses
# a WebContentsView for the remote claude.ai surface, so patching only the local
# mainView leaves those pages untranslated.  This is a runtime-only change to
# the redirected app.asar; the official WindowsApps files remain untouched.
$mainBundle = Join-Path $unpacked '.vite\build\index.pre.js'
if (-not (Test-Path $mainBundle)) { throw '当前 Claude 版本缺少主进程入口 index.pre.js，需要更新适配。' }
$mainHook = @'
;(()=>{try{
  const {app}=require('electron');
  const fs=require('node:fs');
  const path=require('node:path');
  const payloadPath=process.env.CLAUDE_ZH_PAYLOAD_PATH||path.join(path.dirname(process.env.CLAUDE_ZH_ASAR_PATH||''),'payload-runtime.js');
  const payload=payloadPath&&fs.existsSync(payloadPath)?fs.readFileSync(payloadPath,'utf8'):'';
  if(!payload)return;
  const installed=new WeakSet();
  const install=wc=>{
    if(!wc||installed.has(wc))return;
    installed.add(wc);
    const run=()=>{try{if(!wc.isDestroyed())wc.executeJavaScript(payload,true).catch(()=>{});}catch{}};
    wc.on('dom-ready',run);
    wc.on('did-finish-load',run);
    wc.on('frame-created',(_event,details)=>{try{const frame=details&&details.frame;if(frame&&typeof frame.executeJavaScript==='function')frame.executeJavaScript(payload,true).catch(()=>{});}catch{}});
  };
  app.on('web-contents-created',(_event,wc)=>install(wc));
}catch{}})();
'@
[IO.File]::AppendAllText($mainBundle, "`n" + $mainHook, [Text.UTF8Encoding]::new($false))
npx --yes @electron/asar pack $unpacked (Join-Path $Dist 'app.asar')
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$vs = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
$cmake = Join-Path $vs 'Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe'
if (-not (Test-Path $cmake)) { throw 'Visual Studio CMake 未安装。' }
& $cmake -S $Root -B (Join-Path $Root 'build') -A x64
if ($LASTEXITCODE -ne 0) { throw 'CMake 配置失败。' }
& $cmake --build (Join-Path $Root 'build') --config Release
if ($LASTEXITCODE -ne 0) { throw '本机注入器编译失败。' }
foreach ($artifact in @('ClaudeChineseLauncher.exe', 'claude-zh-hook.dll')) {
    $source = Join-Path $Root "build\Release\$artifact"
    $target = Join-Path $Dist $artifact
    try {
        Copy-Item $source $target -Force
        Remove-Item "$target.pending" -Force -ErrorAction SilentlyContinue
    } catch [System.IO.IOException] {
        Copy-Item $source "$target.pending" -Force
        Write-Warning "$artifact 正被运行中的 Claude 占用，已暂存；下次从「Claude 中文版」启动时自动更新。"
    }
}
Set-Content -LiteralPath (Join-Path $Dist 'claude-version.txt') -Value $package.Version -Encoding ascii
Write-Host "语言包构建完成：$Dist"
