# Claude Desktop 简体中文运行时语言包

这是一个不修改 Claude Desktop 安装目录的本地 DLL 运行时中文注入器。

## 使用方法

1. 右键运行 `Install.ps1`（或在 PowerShell 中执行它）。
2. 从系统托盘完全退出正在运行的 Claude。
3. 双击桌面上的 **Claude 中文版**。
4. 在语言菜单中选择 **Chinese (Simplified)** 或 English；也可以按 `Ctrl+Shift+L` 快速切换。

## 工作方式

- 始终启动 Microsoft Store 安装的官方 Claude Desktop。
- 启动器以暂停状态创建官方 Claude 进程，只向该进程注入本地 DLL。
- DLL 只把 Claude 对本地 `app.asar` 的读取重定向到中文副本，并对子进程自动延续注入；它不再强制替换官方前端语言文件。
- `frontend-zh-CN.json` 和运行时词典负责实际翻译；语言菜单和 `Ctrl+Shift+L` 决定是否启用中文，English 会恢复原文，不修改 `WindowsApps`。
- 当前 Claude `1.52386.6.0` 的前端 `27,325` 个词条已生成 `dist\frontend-zh-CN.json`，其中 `27,176` 个已翻译；剩余主要是 URL、协议名、代码标识符和品牌名。
- 页面刷新、登录跳转和新窗口会自动重新注入。
- 不修改 `WindowsApps`、`app.asar`、账号数据或聊天内容。

## 限制

- Claude 必须通过“Claude 中文版”快捷方式启动。
- 如果官方 Claude 已在后台运行，需要先从托盘退出。
- 安全软件可能拦截进程注入，需要将本目录加入本机信任列表。
- Claude 更新后第一次启动会自动重新构建适配；如果内部文件结构变化，会明确报错而不会修改官方程序。
- 对话内容、代码、作品和输入框正文会被排除，不会被翻译。

## 更新词典

`tools\` 中保留了线上词典合并、Google 翻译和 ICU 占位符校验脚本。Claude 更新后，先生成对应版本的前端词典，再运行构建脚本；脚本不会修改 `WindowsApps`。

## 卸载

运行 `Uninstall.ps1`。它只移除快捷方式，不影响官方 Claude。
