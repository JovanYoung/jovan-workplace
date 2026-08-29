# Jovan's Workplace · 个人 AI 工作台

> **本地优先 · 数据不出本机 · 一句话添加日程**
> Local-first AI personal workspace — your data stays on your disk.

<p align="center">
  <a href="#中文指南" style="display:inline-block;padding:6px 18px;margin:0 6px;border-radius:999px;background:#f97316;color:#fff;text-decoration:none;font-weight:600">🇨🇳 中文指南</a>
  <a href="#english-guide" style="display:inline-block;padding:6px 18px;margin:0 6px;border-radius:999px;border:1px solid #31595a;color:#31595a;text-decoration:none;font-weight:600">🇬🇧 English Guide</a>
</p>

---

## 中文指南

<a id="中文指南"></a>

### 🎉 欢迎

Jovan's Workplace 是一个**完全本地、数据由你掌控**的个人效率工作台：四象限待办、日程管理、随手备忘、学习记录、亲友画像，加上**一句话智能添加**——像聊天一样把你的安排变成日程。

### ⬇️ 安装

| 方式 | 操作 |
|---|---|
| **下载器（推荐）** | 双击 `Jovans-Workplace-Installer-0.0.0.exe` → 三步引导：① 选数据存放位置 ②（可选）开启 ima 云备份 ③ 安装 + 桌面快捷方式 |
| **绿色直用** | 解压 `Jovan's Workplace-0.0.0-win.zip` → 双击 `Jovan's Workplace.exe` |

> ⚠️ **首次运行必读**：应用未做代码签名（个人项目），Windows 会提示「未知发布者」→ 点 **更多信息 → 仍要运行** 即可；个别杀毒软件可能误报，选择「允许运行」即可（不放心的可用绿色 zip 方式）。系统要求：**Windows 10 及以上**。

### 🧭 快速上手（五大模块）

#### 📋 今日 —— 四象限待办
按「紧急且重要 / 紧急不重要 / 重要不紧急 / 都不重要」四象限组织当天要事，**红色优先处理**。点击卡片可完成、查看详情或编辑。

#### 📅 日程与任务 —— 四种视图
- **日视图**（默认）：当天全部事件按优先级排列 → 0-24 时间轴 → 未设置时段的事件单独列表，可随时补设时段
- **周视图**：整周分布一目了然，单击选中、**双击某天进入日视图**
- **日历**：按月浏览，单击选中日期、双击进入日视图
- **列表**：按时间顺序平铺

> 💡 添加时在「详情」里写 `15:00-16:00` 或 `下午3点`，事件会自动进时间轴；填「地点」字段（如：图书馆三楼），事件卡上会显示 📍 位置。

#### 📝 备忘 —— 老忘记的事儿 + 亲友画像
- **老忘记的事儿**：随手记那些总忘的事
- **亲友画像**：记录亲友的**忌口 / 雷点 / 喜好 / 生日**（生日自动提醒）

#### 🎓 学习
- **校内**：按 学期 → 科目 → 笔记 / 课件（tut / lect）组织；课件支持翻译与提问
- **校外备考**：独立空间，按标签管理

#### 🤖 一句话添加
顶部输入框直接说：`周五交计网作业，紧急` → 自动解析日期、时间、优先级，一键入库。解析拿不准时点「AI 深度解析」兜底。

### ⚙️ 设置

- **外观**：主题三档（跟随系统 / 浅色 / 深色）、导航栏四位置（上 / 左 / 右 / 下）、内容宽度
- **快捷键**：全部可自定义（快速添加、五个模块切换、Esc），点「修改」后直接按下新组合键录制
- **数据**：立即备份 / 导出 JSON / 导入恢复 / ima 云备份开关
- **系统**：操作日志（自动留痕 1 年）、回收站（30 天内可恢复）

### 🔒 数据与隐私

- 数据 100% 存在**你选的本地文件夹**（`workspace.json`），不依赖任何云服务
- **原子写入**防文件损坏 + 写入前快照（10 份）+ **每日自动备份**（保留 30 份）
- ima 云备份**默认关闭**，开启后 API Key 用系统加密只存本地，绝不上传
- 旧版数据（`D:\dsh-data`）首次运行可**一键接管**，无缝迁移
- 农历 / 生日完全本地计算

### ❓ 常见问题

| 问题 | 解决 |
|---|---|
| 打开弹「未知发布者」？ | 点「更多信息 → 仍要运行」（未签名，正常现象）|
| 杀毒软件报毒？ | 未签名 Electron 应用常见误报，选「允许运行」；或改用绿色 zip |
| AI 功能没反应？ | 一句话解析 / 翻译 / 课件提问 / Agent 需先启动本地服务 dsh-bridge（`127.0.0.1:8787` / `3080`）；**数据读写不受影响** |
| 换电脑数据怎么办？ | 设置 → 数据 → 导出 JSON，新电脑导入恢复；或开启 ima 云备份 |
| 装不上 / 打不开？ | 确认 Windows 10+、磁盘 ≥ 400MB、SmartScreen 已放行 |

### 📦 版本

- 当前版本：**v0.0.0**（2026-08-28 首发）
- 下载：**[GitHub Releases](https://github.com/JovanYoung/jovan-workplace/releases)**（zip 校验 SHA256 已内置下载器）

---

## English Guide

<a id="english-guide"></a>

### 🎉 Welcome

Jovan's Workplace is a **fully local, data-you-own** productivity workspace: a 4-quadrant task board, schedules, quick memos, study notes, family profiles — plus **one-sentence AI capture**: type naturally and it becomes a schedule item.

### ⬇️ Install

| Method | Steps |
|---|---|
| **Installer (recommended)** | Run `Jovans-Workplace-Installer-0.0.0.exe` → 3-step setup: ① pick data folder ② (optional) enable ima cloud backup ③ install + desktop shortcut |
| **Portable** | Unzip `Jovan's Workplace-0.0.0-win.zip` → double-click `Jovan's Workplace.exe` |

> ⚠️ **Before first run**: the app is **unsigned** (personal project), so Windows will show an "Unknown publisher" prompt — click **More info → Run anyway**. Some antivirus tools may flag unsigned Electron apps; choose "Allow". **Requires Windows 10+.**

### 🧭 Modules

- **📋 Today** — 4-quadrant tasks (urgent × important); red items first. Click a card to complete / view / edit.
- **📅 Schedule & Tasks** — four views: **Day** (priority event cards → 0-24 timeline → un-timed events, editable), **Week** (single-click select, **double-click to open a day**), **Month** (calendar grid, same click/double-click), **List** (chronological).
  - 💡 Write `15:00-16:00` or `3pm` in the details to pin an event to the timeline; add a **location** (e.g. Library, 3F) to show a 📍 marker.
- **📝 Memos** — "Things I keep forgetting" + **family profiles** (allergies, pet peeves, favorites, birthdays with auto-reminders).
- **🎓 Study** — on-campus (semester → course → notes/slides, tut·lect) + off-campus exam prep with tags; slides support translation & Q&A.
- **🤖 One-sentence capture** — e.g. `Homework due Friday, urgent` → auto-parses date, time, priority. Fall back to "AI deep parse" when unsure.
- **⚙️ Settings** — theme (system/light/dark), nav position (top/left/right/bottom), fully customizable shortcuts (recording-style), data (backup/export/import), logs & trash (30-day recovery).

### 🔒 Data & Privacy

- Data lives **100% on your chosen local folder** (`workspace.json`); no cloud dependency.
- Atomic writes (anti-corruption) + pre-write snapshots (10) + **daily backups (keep 30)**.
- ima cloud backup **off by default**; if enabled, the API key is encrypted locally and **never uploaded**.
- Legacy data at `D:\dsh-data` can be **adopted in one click** on first run.
- Lunar calendar & birthdays computed fully offline.

### ❓ FAQ

| Issue | Fix |
|---|---|
| "Unknown publisher" prompt? | More info → Run anyway (unsigned, expected) |
| Antivirus flags the app? | Common false positive for unsigned Electron; allow it, or use the portable zip |
| AI features not working? | One-sentence parse / translation / slide Q&A / Agent need the local dsh-bridge (`127.0.0.1:8787` / `3080`); **data I/O is unaffected** |
| Switching computers? | Settings → Data → Export JSON, then Import on the new machine; or enable ima cloud backup |
| Won't install / open? | Ensure Windows 10+, ≥400MB free disk, SmartScreen allowed |

### 📦 Version

- Current: **v0.0.0** (first release, 2026-08-28)
- Download: **[GitHub Releases](https://github.com/JovanYoung/jovan-workplace/releases)** (SHA256 auto-verified by the installer)

---

*Made with ❤️ by JovanYoung · Local-first, always.*
