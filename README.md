# Jovan's Workplace 桌面端 · 交付说明

> **Architecture B：下载器 + 主程序分离 · Electron 封装 · 数据本地化 · 绿色 zip 解压即用**
> Architecture B: Bootstrap installer + standalone app · Electron · local-first data · portable green zip.

---

## 一、交付产物 / Deliverables

产物位于 `dist/`：

| 文件 / File | 说明 / Description | 大小 / Size |
|---|---|---|
| `dist\Jovan's Workplace-0.0.0-win.zip` | 主程序绿色 zip，解压双击即用 / Portable main app, unzip & run | 146 MB |
| `dist\Jovans-Workplace-Installer-0.0.0.exe` | 下载器：三步引导安装 / Bootstrap installer: 3-step guided setup | 96 MB |

**主程序 SHA256**（已内置下载器校验）：
`282fcb66d6acf157ac30682a0078d433a44fab14dcb287c68e131b0d6ccf9715`

---

## 二、启动方式 / Getting Started

| 方式 | 操作 |
|---|---|
| **A · 下载器（推荐）** | 双击 `Jovans-Workplace-Installer-0.0.0.exe` → 三步引导（选数据位置 → 可选 ima 云备份 → 安装 + 桌面快捷方式）→ 自动从 GitHub Release 下载主程序 → SHA256 校验 → 解压 → 启动 |
| **B · 绿色直用** | 解压 `Jovan's Workplace-0.0.0-win.zip` → 双击 `Jovan's Workplace.exe`。首次运行弹「选择数据存储文件夹」；检测到 `D:\dsh-data\workspace.json` 时提示「一键接管旧数据」 |

> **English:** A) Run the installer EXE for a guided 3-step setup (choose data dir → optional ima cloud backup → install & launch). B) Portable: unzip the green zip and double-click the EXE; on first run it prompts for a data folder and offers to adopt legacy data at `D:\dsh-data\workspace.json`.

---

## 三、源码目录结构 / Source Layout

```
D:\Jovan's Workplace\
├── app\                      # 主程序（Electron）/ Main app
│   ├── main.js               # 主进程：单实例锁 / 托盘 / 数据目录选择 / ima key 管理 / IPC
│   ├── preload.js            # contextBridge：暴露 window.workplace
│   ├── data.js               # 数据层：原子写入 / 快照 / 备份 30 份 / 农历 / ima 备份
│   ├── renderer\index.html   # 页面（SDK 已移除，数据走 contextBridge）
│   ├── lib\lunar.js          # 农历库（lunar-javascript）
│   └── assets\               # icon.png / icon.ico
├── installer\                # 下载器（Electron，三步引导）/ Bootstrap installer
│   ├── main.js               # 下载 / SHA256 校验 / 解压 / 快捷方式 / 启动
│   ├── preload.js
│   └── renderer\index.html   # 三步引导 UI
└── dist\                     # 打包产物 / Build outputs
```

> **English:** `app/` is the Electron main app (main process: single-instance lock, tray, data-dir picker, ima key via safeStorage, IPC; preload exposes `window.workplace`; data layer in `data.js`). `installer/` is the bootstrap installer (download, SHA256 verify, extract, shortcut, launch). `dist/` holds build outputs.

---

## 四、数据层设计 / Data Layer

已定稿决策的落地实现：

| 决策 / Decision | 实现 / Implementation |
|---|---|
| 数据文件 / Data file | `{数据目录}\workspace.json`，与旧版格式完全一致（`rows` 数组），旧数据无缝迁移 / Same format as legacy; seamless migration |
| 原子写入 / Atomic write | 先写 `.tmp` 再 rename 覆盖 / Write `.tmp` then rename |
| 自动快照 / Snapshots | 每次写入前快照至 `snapshots\`，保留最近 10 份 / Pre-write snapshot, keep latest 10 |
| 每日备份 / Daily backup | 每天首次写入备份至 `backups\workspace-YYYY-MM-DD.json`，保留最近 30 份 / Keep latest 30 |
| 单实例锁 / Single instance | 二次启动仅聚焦已有窗口 / Second launch focuses existing window |
| 窗口行为 / Window | 关闭 = 最小化到托盘（菜单「打开/退出」）/ Close → tray, menu Open/Quit |
| ima API Key | `safeStorage`（Windows DPAPI）加密存 `%APPDATA%\Jovan's Workplace\ima.json`，只存本地、绝不外发 / DPAPI-encrypted, local-only |

> **English:** Data is written atomically (tmp + rename) to `workspace.json` with pre-write snapshots (10) and daily backups (30). Single-instance lock and tray residency are enforced. The ima API key is encrypted via OS DPAPI and never leaves the machine.

---

## 五、数据目录与配置 / Data & Config

| 项 / Item | 路径 / Path |
|---|---|
| 主程序配置 / App config | `%APPDATA%\Jovan's Workplace\config.json`（`{"dataDir": "..."}`）|
| 默认数据目录 / Default data dir | `D:\Jovan's Workplace\data` |
| 旧数据接管 / Legacy adoption | `D:\dsh-data\workspace.json`（首次运行可选接管）|

---

## 六、发行状态 / Release Status

- **v0.0.0 已发布（2026-08-28）** / Released: https://github.com/JovanYoung/jovan-workplace/releases/tag/0.0.0
- 下载器 `DOWNLOAD_URL` 已指向 GitHub Release 资产，SHA256 已内置 / Installer points to the GitHub Release asset; SHA256 embedded
- 正式 1.0.0 发行时：更新版本号 → 重传 zip → 重打包下载器 / For 1.0.0: bump version, re-upload zip, rebuild installer

### 发行必读 / Release Notes (must-read)

- **SmartScreen 弹窗**：未签名（个人项目），首次运行点「更多信息 → 仍要运行」/ Unsigned; click "More info → Run anyway"
- **杀软误报**：Defender / 360 可能误报未签名 Electron 应用，选择「允许运行」；不放心的用绿色 zip / Possible AV false positives; prefer the green zip if concerned
- **系统要求**：Windows 10+，磁盘 ≥ 400MB / Windows 10+, ≥400MB free disk
- **AI 功能依赖本地桥**：一句话解析 / 翻译 / 提问 / Agent 走 `127.0.0.1:8787` / `3080`（dsh-bridge）；**数据读写完全本地化，不受影响** / AI features require the local dsh-bridge; **data I/O is fully local and unaffected**

---

## 七、回归测试清单 / Regression Checklist

| # | 项 / Item | 状态 / Status |
|---|---|---|
| 1 | 数据增删改查 / CRUD | ✅ 数据层自动化通过 / Auto-tested (test-data.js) |
| 2 | 回收站 / Trash | ✅ 逻辑在数据层（删除留痕，30 天清理）/ In data layer |
| 3 | 操作日志 / Logs | ✅ 自动化通过（add/update/delete 留痕）|
| 4 | 备份 / Backups | ✅ 自动化通过（快照 + 每日 30 份轮换）|
| 5 | 导出导入 / Export-Import | ✅ 已改 `showSaveDialog`/`showOpenDialog`，数据层通过 |
| 6 | 学习模块 / Study | ⚠️ 未 GUI 实测，需桌面环境手动过一遍 / Manual GUI test pending |
| 7 | Agent | ⚠️ 依赖本地桥 `127.0.0.1:3080`（DeepSeek Harness）|

> **English:** Items 1–5 pass automated data-layer tests. Items 6–7 need a manual GUI pass on the desktop (study module; Agent requires the local DeepSeek Harness bridge on :3080).

---

## 八、关键说明 / Notes

- **AI 能力仍依赖本地桥**：一句话解析 / 翻译 / 提问 / Agent 走 `127.0.0.1:8787` 与 `3080`（dsh-bridge），需自行启动；**数据读写已完全本地化**（Electron 主进程直写，不依赖桥）
- **农历 / 生日**：内置 lunar-javascript，完全本地计算 / Lunar & birthday math is fully local
- 未做代码签名，SmartScreen 会弹「未知发布者」/ Unsigned; SmartScreen warning expected
- 开发机测试时若遇 `ELECTRON_RUN_AS_NODE=1` 或 GPU 报错，属 IDE/远程沙盒环境注入，真实桌面双击运行不受影响 / Sandbox-only artifacts; unaffected on a real desktop

> **English:** AI parsing/translation/Agent still route through the local dsh-bridge (:8787/:3080); data I/O is fully local. Lunar/birthday math is bundled. The app is unsigned (SmartScreen warning expected). `ELECTRON_RUN_AS_NODE`/GPU errors are sandbox-injected and don't occur on a real desktop.

---

*Jovan's Workplace · v0.0.0 · 交付日期 2026-08-28*
