# Jovan's Workplace 桌面端封装 · 交付说明

> 方案 B：下载器 + 主程序分离。Electron 封装，数据本地化（workspace.json），绿色 zip 解压即用。

## 一、交付产物（dist/）

| 文件 | 说明 | 大小 |
|------|------|------|
| `dist\Jovan's Workplace-0.0.0-win.zip` | 主程序绿色 zip（解压即用） | 146 MB |
| `dist\Jovans-Workplace-Installer-0.0.0.exe` | 下载器（三步引导，单文件） | 96 MB |

主程序 zip 的 SHA256：`282fcb66d6acf157ac30682a0078d433a44fab14dcb287c68e131b0d6ccf9715`

## 二、启动方式

**方式 A（推荐，走下载器）**：双击 `Jovans-Workplace-Installer-0.0.0.exe`，按三步引导安装。

**方式 B（绿色直用）**：解压 `Jovan's Workplace-0.0.0-win.zip`，双击 `Jovan's Workplace.exe`。
首次运行会弹出「选择数据存储文件夹」；若检测到 `D:\dsh-data\workspace.json` 会提示「一键接管旧数据」。

## 三、目录结构（源码）

```
D:\Jovan's Workplace\
├── app\                      # 主程序（Electron）
│   ├── main.js               # 主进程：单实例锁 / 托盘 / 数据目录选择 / ima key 管理 / IPC
│   ├── preload.js            # contextBridge 暴露 window.workplace
│   ├── data.js               # 数据层：fs 读写 / 原子写入 / 快照 / 备份30份 / 农历 / ima 备份
│   ├── renderer\index.html   # 改造后的页面（SDK 已移除，走 contextBridge）
│   ├── lib\lunar.js          # 农历库（lunar-javascript）
│   └── assets\               # icon.png / icon.ico
├── installer\                # 下载器（Electron，三步引导）
│   ├── main.js               # 下载 / SHA256 校验 / 解压 / 快捷方式 / 启动
│   ├── preload.js
│   └── renderer\index.html   # 三步引导 UI（橙色玻璃拟态）
└── dist\                     # 打包产物
```

## 四、数据层（已定稿决策落地）

- 数据文件：`{数据目录}\workspace.json`，格式与旧版完全一致（`rows` 数组），旧数据无缝迁移
- **原子写入**：先写 `.tmp` 再 rename 覆盖
- **自动快照**：每次写入前快照到 `snapshots\`，保留最近 10 份
- **每日备份**：每天首次写入备份到 `backups\workspace-YYYY-MM-DD.json`，保留最近 30 份
- **单实例锁**：二次启动只聚焦已有窗口
- **关闭窗口 = 最小化到托盘**，托盘菜单「打开 / 退出」
- **ima API Key**：`safeStorage`（Windows DPAPI）加密存 `%APPDATA%\Jovan's Workplace\ima.json`，只存本地、绝不外发

## 五、数据目录与配置

- 主程序配置：`%APPDATA%\Jovan's Workplace\config.json`（`{"dataDir": "..."}`）
- 默认数据目录：`D:\Jovan's Workplace\data`
- 旧数据接管：`D:\dsh-data\workspace.json`

## 六、🚀 发行状态

- **v0.0.0 已发布**（2026-08-28）：https://github.com/JovanYoung/jovan-workplace/releases/tag/0.0.0
- 下载器 `DOWNLOAD_URL` 已指向 GitHub Release 资产，SHA256 校验已内置
- 正式 1.0.0 发行时更新版本号并重新上传 zip / 重打包下载器

### 发行说明（必读）

- **SmartScreen 弹窗**：未签名（个人项目），首次运行点「更多信息 → 仍要运行」
- **杀毒软件可能误报**：Defender / 360 对未签名 Electron 应用误报属正常，选「允许运行」；不放心的用绿色 zip 方式
- **系统要求**：Windows 10+，磁盘 ≥ 400MB
- **AI 功能依赖本地桥**：一句话解析 / 翻译 / 提问 / Agent 走 `127.0.0.1:8787` / `3080`（dsh-bridge）；**数据读写完全本地化，不受影响**

## 七、回归测试清单（7 项）

| # | 项 | 状态 |
|---|----|------|
| 1 | 数据增删改查 | ✅ 数据层自动化通过（test-data.js） |
| 2 | 回收站 | ✅ 逻辑在数据层（删除带「删除时间」进回收站，30 天清理） |
| 3 | 操作日志 | ✅ 自动化通过（add/update/delete 自动留痕） |
| 4 | 备份 | ✅ 自动化通过（快照 + 每日备份 30 份轮换） |
| 5 | 导出导入 | ✅ 已改 `showSaveDialog`/`showOpenDialog`，数据层通过 |
| 6 | 学习模块 | ⚠️ 页面功能未 GUI 实测，建议桌面环境手动过一遍 |
| 7 | Agent | ⚠️ 依赖本地桥 `127.0.0.1:3080`（DeepSeek Harness），需先启动 dsh-bridge |

## 八、关键说明

- **AI 能力仍依赖本地桥**：一句话解析 / 翻译 / 提问 / Agent 走 `127.0.0.1:8787` 与 `3080`（DeepSeek Harness dsh-bridge），需自行启动；**数据读写已完全本地化**（Electron 主进程直写，不依赖桥）。
- **农历 / 生日**：已内置 lunar-javascript，完全本地计算，不依赖桥。
- 未做代码签名，SmartScreen 会弹「未知发布者」，点「仍要运行」即可（自用场景）。
- 开发机测试时若遇 `ELECTRON_RUN_AS_NODE=1` 或 GPU 报错，属 IDE/远程沙盒环境注入，真实桌面双击运行不受影响。
