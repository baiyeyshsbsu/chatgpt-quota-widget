# 组件优化与新功能方案（审阅报告）

日期：2026-10-12 ｜ 状态：**仅提案，未改动任何代码**

审阅范围：`src/main/`（main / subscription-store / quota-service / sub2api-service / store / preload）、
`src/renderer/`（renderer.js 1313 行 / styles.css / index.html）、测试与构建脚本、运行时 `userData` 产物。

已核实无需担心的项：Sub2API 令牌使用 Electron `safeStorage`（Windows DPAPI）加密 ✔；
quota 请求带超时与重试 ✔；`requestSingleInstanceLock` 防多开 ✔；写文件均为 tmp+rename 原子写 ✔。

---

## A. 建议尽快修的逻辑问题（小改动，收益明显）

### A1. 货币符号硬编码 ¥
`renewalCardHtml` 与月支出文案直接写 `¥`，但数据模型里有 `item.currency` 字段（默认 CNY）却从未使用。
建议：映射 `{ CNY: "¥", USD: "$", EUR: "€" }`，编辑表单暴露货币下拉。改动点：renderer.js 两处 + STR 文案。

### A2. 月支出把「已归档」订阅的历史价格算进去
`subscription-store.js` `summary()` 中 `monthlyTotal` 只排除 `amount == null`，归档项价格照常折算月支出，
而 `count` 用的是 activeItems——口径不一致，归档老价格会虚增月支出。
建议：`monthlyTotal` 与 `count` 统一只算未归档项（或额外给 `lifetimeCost` 全量口径，见 D3）。

### A3. 信标平时显示「剩 25 天」这类远期倒计时，语义突兀
现在信标永远展示最紧迫一项的天数，即使距离到期还有一个月。原设计中信标是「提醒信标」，不该当日历用。
建议：无 due/expired 项时信标降为灰色低调显示（或只在新添加后短暂出现），临近提醒阈值才亮色。
纯渲染层改动，一条 CSS class 判断。

### A4. 「稍后 1 小时」只压弹层，压不住 60 秒一次的信标重绘
`snooze()` 只写 `snoozedUntil`，而 `scan()` 的节流仅影响 `alerts` 数组；渲染层信标读的是
`summary.items`，不看 `snoozedUntil`。用户点「稍后」后红色信标依旧在闪，容易烦躁。
建议：`renderRenewalBeacon()` 把 `now < snoozedUntil` 的项目视同静音处理（或给 summary 透出 `alertSuppressed` 标记）。

### A5. 每次启动窗口强制回到右上角，拖动位置不持久化
`main.js` 第 71 行每次 ready 都 `placeWindowTopRight()`。悬浮组件的核心诉求就是钉在习惯的位置。
建议：`mainWindow.on("moved")`（节流 1s）把 bounds 存入 `widget-preferences.json`，
启动时恢复并做「仍在某块屏幕工作区内」校验（多显示器拔掉后回退右上角）。

---

## B. 性能与健壮性

### B1. 每 2 分钟 spawn 一次 Codex app-server 子进程
`requestSnapshot()` 每次读取都冷启动 `codex app-server --listen stdio://`，进程存活期间持续占 CPU/内存峰值。
建议（二选一）：常驻一个长连接进程复用；或把轮询间隔做成设置项（2/5/15 分钟），并在窗口隐藏时降频。

### B2. 无网络/休眠期间定时器照跑
笔记本合盖唤醒后定时器会「补课」式连发。建议监听 `powerMonitor.on("resume")` 统一触发一次刷新并顺延计时器；
Sub2API 连接失败时把 5 分钟轮询退避到 15 分钟（现有错误分类已具备判断依据）。

### B3. widget.log 无轮转、重复刷屏
实测日志 116 KB，其中 `sub2api-list-failed` 重复了 **1658 次**（每 5 分钟一条的固定失败）。
建议：① 写入前去重——同一事件在 N 分钟内重复只记一条并附 `xN` 计数；② 超过 512 KB 轮转保留一份 `.1`。

### B4. 重建前旧实例锁文件
`npm run build` 在旧实例运行时报 Access denied（PROJECT_LESSONS 已记录）。可以在 build 脚本前置一个
检查：发现 `dist/win-unpacked/ChatGPT Quota Widget.exe` 有进程占用就明确提示「先从托盘退出」，替代晦涩报错。

---

## C. 续费提醒功能的补强

| # | 功能 | 说明 | 成本 |
|---|------|------|------|
| C1 | 贪睡时长可选 | 弹层「稍后」拆成 1 小时 / 今天晚些 / 明天 / 本周（明天= 跳过 due 但保留 expired 升级）；`snooze(id, ms)` 后端已支持任意毫秒，纯 UI 菜单 | 低 |
| C2 | 到期前 N 天的分级预告 | 除了 ≤3 天爆红，增加「提前 7 天温和提示」档（灰→琥珀→红三级），remindBeforeDays 字段可扩展成数组 | 中 |
| C3 | 撤销（undo） | 删除和「全部已续费」是批量破坏性操作；toast 上加 5 秒「撤销」按钮，store 保留最近一次快照即可实现（`remove`/`renewAllDue` 返回前存 `_lastMutation`） | 低 |
| C4 | 导出 .ics 日历 | 续费提醒面板加「导出日历」，把各项到期日生成 ICS 文本导入手机/Outlook，出门在外也有提醒 | 低 |
| C5 | 付款页直达 | 托盘菜单和弹层已有列表入口，但 payUrl 只在清单卡片出现；弹层 compact 卡片应带「付款页」（`renewalCardHtml(item, true)` 目前省略了 actions） | 低 |
| C6 | 提醒总开关进托盘菜单 | 托盘现在只有「显示/退出」；加「暂停续费提醒 1 小时 / 今日」和「打开续费清单」两项，`subs:settings:set` 后端已就绪 | 低 |
| C7 | 开机自启 | Windows 下 `app.setLoginItemSettings({ openAtLogin })`，托盘菜单加开关；对常驻桌面组件很实用 | 低 |
| C8 | 到期日重复模式 | 除「顺延 N 天」外支持「每月同日」「每年同日」锚点（月付按日对齐的场景顺延会逐月漂移）；store 的 `renew()` 基址逻辑预留了 source 字段 | 中 |
| C9 | 历史查看 UI | store 里 history（cap 20）已经记了每次顺延/手改日期，但界面上完全看不到；清单卡片展开或编辑表单底部显示最近几条 | 低 |

## D. 可新增的独立功能

- **D1 支出维度扩展**：年度总支出、按项目累计已花费（利用 amount×续订次数），在「续费提醒」摘要行加一个切换（月支出/年支出）。
- **D2 额度异常事件提醒**：额度跌破阈值（如 ≤5%）或归零时，除变色外也发一次托盘气泡——现在只有静默的颜色变化，人不在屏幕前就错过了。去重回调可复用 subs 扫描的节流模式。
- **D3 订阅健康度**：清单里显示「已连续续费 N 次 / 加入于 …」，帮用户识别早就不用了的订阅（归档建议）。
- **D4 多语言开关**：STR 双语齐全，但 `lang` 是写死的 `"zh"`；加个托盘/设置里的切换即可（小彩蛋级工作量）。
- **D5 中转站账号快捷打开**：账号行点击直接打开 Sub2API 对应账号页（baseUrl 已存，拼路径即可）。

## E. 工程结构（不急，动大功能前顺手做）

- **E1 renderer.js 拆分**（1313 行）：STR 文案、quota 视图、renewal 视图、accounts 抽屉四块天然可分文件；现有 renderer-contract 测试是按正则扫单文件的，拆分时要同步调整。
- **E2 主进程模块化**：main.js 612 行里订阅扫描（约 90 行）可以独立成 `subscription-alerts.js`，与 tray 依赖注入解耦后更易测。
- **E3 CI**：GitHub Actions 跑 `npm test`（纯 node:test，无 Electron 依赖也能跑大部分；契约测试需要文件在库内，可行）。
- **E4 版本号策略**：现在产物固定 `0.1.0`，改 `package.json` version + 让 artifactName 带版本，方便区分桌面新旧包。

---

## 优先级建议

1. **第一批（体验立竿见影，全是小改）**：A5 窗口位置持久化、A4 贪睡压信标、C3 撤销、C6 托盘开关、B3 日志治理
2. **第二批（正确性）**：A1 货币、A2 月支出口径、C5 弹层付款页、C9 历史展示
3. **第三批（省电与规模）**：B1 轮询策略、C1 贪睡菜单、C2 分级预告、D1/D2
4. **有余力**：C8 重复模式、C4 ICS、D 其余、E 全部
