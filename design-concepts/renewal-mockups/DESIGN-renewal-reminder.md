# 续费提醒（手动充值项）功能设计方案

状态：**已按方案 A 实现**（2026-10-06）。用户选定方案 A，并要求续费时间可手动调整——
编辑表单提供日期输入框，`update()` 以 `source: "manual-date"` 记录历史。
落地点：`src/main/subscription-store.js`（独立 `subscriptions.json` 存储）、
`src/main/main.js`（60s 扫描 + 托盘变色/气泡 + `subs:*` IPC）、
`src/renderer/`（主界面信标、个人主页 Tab、清单/编辑/快速添加表单、提醒弹层），
测试见 `test/subscription-store.test.js`。本目录下的 HTML/PNG 仍是当初的视觉原型。

日期：2026-10-06

---

## 1. 需求拆解

| # | 需求 | 设计落点 |
|---|---|---|
| R1 | 可以添加需要自己手动充值/续费的付费项目 | 订阅条目 CRUD + 抽屉内表单 |
| R2 | 组件启动时生效，可设置这些项目 | 主进程常驻定时器扫描，随 app 启动 |
| R3 | 距到期 ≤3 天时「爆红」并弹窗提示续费 | 三级状态机 + 提醒通道（轨道变红 / 弹层 / 托盘气泡 / 独立置顶窗） |
| R4 | 续费成功后点一下自动 +30 天 | 一键「已续费」按钮，按条目周期顺延并写历史 |
| R5 | 顺便重新排版 | 轨道与抽屉的布局改造（见第 3 节三个方案） |

关键取舍：**「3 天」和「30 天」都做成条目级参数，不写死。** 默认值就是 3 和 30，符合你的习惯，但中转站套餐、服务器、按年付的项目周期不同，写死会导致这个功能只能服务一种账单。

---

## 2. 数据与逻辑设计

### 2.1 存储

新建 `userData/subscriptions.json`，**不要塞进 `store.json`**。`store.json` 由 `loadStore()` 做 legacy 合并、且 `readStore()` 只挑它认识的字段（`src/main/store.js:54`），把订阅塞进去会被下一次合并静默丢掉。独立文件 + 独立模块 `subscription-store.js` 最安全。

```jsonc
{
  "version": 1,
  "settings": {
    "enabled": true,
    "defaultRemindBeforeDays": 3,
    "defaultCycleDays": 30,
    "channels": { "rail": true, "sheet": true, "balloon": true, "popup": false },
    "quietHours": { "from": "23:30", "to": "07:00" }
  },
  "items": [
    {
      "id": "sub_xxx",
      "name": "ChatGPT Plus",
      "renewsAt": "2026-10-09T00:00:00+08:00",
      "cycleDays": 30,
      "remindBeforeDays": 3,
      "amount": 128,
      "currency": "CNY",
      "payUrl": "",
      "renewFrom": "today",        // today | oldDeadline：顺延起算方式
      "muted": false,
      "archived": false,
      "lastAlertAt": null,
      "snoozedUntil": null,
      "createdAt": "...",
      "updatedAt": "...",
      "history": [
        { "at": "2026-09-09T10:00:00+08:00", "from": "2026-09-09", "to": "2026-10-09", "days": 30, "source": "manual" }
      ]
    }
  ]
}
```

写入沿用 `store.js` 的做法：`*.tmp` + `fs.renameSync` 原子替换。

### 2.2 状态机

```
daysLeft = ceil((renewsAt - now) / 86400000)

ok        daysLeft > remindBeforeDays          绿/灰，静默
due-soon  0 < daysLeft <= remindBeforeDays     红，脉冲，弹层
expired   daysLeft <= 0                         深红 + 徽标计数，每天重复提醒
```

### 2.3 一键顺延（R4 的核心语义）

`renew(id, days?)`：

- `days` 缺省取 `item.cycleDays`（默认 30）。
- `renewFrom = "today"` → `renewsAt = 今天 + days`（**推荐默认**：你实际是「今天付的钱」，从旧到期日累加会凭空多出几天的免费期）。
- `renewFrom = "oldDeadline"` → `renewsAt = max(旧 renewsAt, 现在) + days`（预付型账单用）。
- 追加一条 `history`，`source: "manual"`。
- 清掉 `snoozedUntil`，`lastAlertAt = null`。
- 返回更新后的条目，UI 就地刷新 + toast「ChatGPT Plus 已顺延至 2026-11-05」。

「全部已续费」= 对当前所有 `due-soon | expired` 条目批量执行同一逻辑。

### 2.4 提醒调度

- 主进程 `setInterval` 每 **60s** 扫描一次（复用 `main.js` 已有的 timer 风格，见 `startSub2apiAccountRefresh`）。
- 只在**状态跃迁**时提醒：`ok → due-soon`、`due-soon → expired`、以及过期后每 24h 一次。避免每分钟弹一次窗。
- 去重靠 `lastAlertAt` + `snoozedUntil`；「稍后」= `snoozedUntil = now + 1h`，「今天不再提醒」= `snoozedUntil = 次日 quietHours.from`。
- 启动时若已处于 `due-soon/expired`，**延迟 3s 再提醒一次**（组件刚起，用户需要立刻看到），但不重复计入 24h 节流。
- 应用退出期间错过的提醒：不做补发，只在下次启动时按当前状态提示一次。

### 2.5 与额度 LED 的关系（重要）

`body[data-state]` 现在被额度独占（`styles.css:33-36`），`--led` 同时驱动 `.status` 和 `.status-dot`。续费提醒**不能覆盖额度颜色**，否则你会误判成「额度用完了」。

方案：新增独立通道 `body[data-alert="due|expired"]`，只驱动新增元素（信标 / 订阅条 / 边框光晕 / 托盘图标），额度色板不动。

例外：`expired`（已经过期 = 服务已经停了）允许叠加一层红色呼吸遮罩，因为这时候「额度不会再回来」和「额度告急」在语义上是一致的。

托盘：`tray.setTitle("3")` + 重建 `nativeImage` 的红点图标；`tray.displayBalloon()` 出气泡。

### 2.6 IPC 契约

`preload.js` 追加：

```js
listSubscriptions: () => ipcRenderer.invoke("subs:list"),
addSubscription: (draft) => ipcRenderer.invoke("subs:add", draft),
updateSubscription: (id, patch) => ipcRenderer.invoke("subs:update", id, patch),
removeSubscription: (id) => ipcRenderer.invoke("subs:remove", id),
renewSubscription: (id, days) => ipcRenderer.invoke("subs:renew", id, days),
renewAllDue: () => ipcRenderer.invoke("subs:renewAll"),
snoozeAlert: (id, ms) => ipcRenderer.invoke("subs:snooze", id, ms),
setSubscriptionSettings: (patch) => ipcRenderer.invoke("subs:settings:set", patch),
onSubscriptionAlert: (cb) => ipcRenderer.on("subs:alert", (_e, r) => cb(r)),
onSubscriptionsUpdated: (cb) => ipcRenderer.on("subs:updated", (_e, r) => cb(r))
```

渲染层不自己算倒计时秒级刷新；主进程每次扫描把 `daysLeft/status` 一起推下来，避免两套时间口径。

### 2.7 布局/窗口影响

- `RAIL_HEIGHT` 620 → 方案 A 保持 620；方案 B/C 需要 660~690（轨道多了常驻区块）。`window:view:set` 已支持传 `height`，改动局限在常量。
- 抽屉宽度 390 不变；续费条目多了以后必须能滚动：`.accounts-panel` 现在是 `flex:none` + 无滚动（`styles.css:431`），需要改成 `overflow-y:auto` + 自定义细滚动条，否则第 5 条会被裁掉。
- i18n：`STR.zh` / `STR.en` 各加约 25 条文案（`renderer.js:12`）。

### 2.8 边界情况清单

| 情况 | 处理 |
|---|---|
| 同一天多项到期 | 合并成一条提醒，弹层列全部，按钮支持「全部顺延 / 单条顺延」 |
| 已过期后补续费 | 按 `renewFrom` 决定起算；UI 上明确写出顺延后的日期，不静默改 |
| 用户手动把日期填成过去 | 保存时允许，直接进 `expired` 态并提示 |
| 周期 365 天 | `remindBeforeDays` 上限 60，避免常年红色 |
| 名称重复 | 允许，ID 区分 |
| 组件隐藏（托盘）时到期 | 只出托盘气泡，不强制 `showWindow()` |
| 系统时间被改/时区 | 一律存带时区的 ISO，比较用 `Date.now()` |
| 全屏演示/游戏中 | `quietHours` + 托盘气泡不抢焦点（`focusable:false`） |

---

## 3. 三个视觉方案

原型文件：`concept-a.html` / `concept-b.html` / `concept-c.html`（浏览器直接打开即可交互看），截图 `concept-*.png`。

### 方案 A · 标签抽屉 + 轨道信标（最小改版）

- 轨道：结构完全不动，只在 7d/5h 开关上方插一枚 34px 高的「续费信标」，常态灰蓝显示最近到期天数，临期转红 + 扩散环。
- 抽屉：顶部加 Tab（账号 / 续费提醒），续费清单按「需要处理 / 正常」分组，卡片带进度条 + 「已续费 · 顺延 30 天」；底部内联「快速添加」表单。
- 提醒：组件内底部弹层卡片，不新开窗口。
- 改动面：`index.html` +1 信标 +1 Tab 容器；`styles.css` +约 180 行；`renderer.js` +约 260 行；主进程新增 store/IPC/定时器。**额度渲染契约零改动。**
- 适合：想低风险加功能，轨道保持现在这个「只有一根柱子」的极简样子。
- 代价：临期时轨道只有一枚小信标，视觉冲击弱；续费清单藏在第二个 Tab 里，不看抽屉就发现不了。

### 方案 B · 轨道常驻订阅条 + 账单日历（推荐）

- 轨道：真正重排版。额度柱压到 230px，腾出常驻「续费提醒」条，最多 3 行「名称 + 剩余天数 + 状态点」，红点闪烁；下方 7d/5h 与两枚图标按钮。轨道高 620 → 660。
- 抽屉：换成账单日历 —— 3 个 KPI（月支出 / 30 天内到期 / 已过期）+ 30 天时间轴（每项一条 lane，红针标出到期日）+ 行内列表，右侧大字天数，一颗红色「已续费 +30 天」。
- 提醒：Windows 托盘气泡（原生、鼠标移开不丢）+ 轨道整体红色呼吸遮罩 + 托盘图标变红带角标。
- 改动面：轨道结构重写（`liquid-meter` 高度、`rail-wrap` 尺寸），比 A 多约 40% 的 CSS 工作量；抽屉需要滚动容器。
- 适合：你确实会同时管 3~6 个账单，希望「扫一眼轨道就知道今天要不要掏钱」。
- 代价：轨道常驻信息密度上升，不再是纯额度表；额度柱变短。

### 方案 C · 独立订阅视图 + 置顶续费弹窗（最彻底）

- 轨道：变成三视图（额度 / 账号 / 订阅），底部 dock 两枚带文字图标按钮；轨道中部一枚**环形倒计时**显示最近到期项，下面叠放订阅小圆点。临期时环形抢视觉主体、额度柱自动降为次要（半透明、缩短）。
- 抽屉：订阅视图，每项一张环形进度卡，带独立开关（点击顺延 / 起算方式 / 仅到日提醒）、付款页链接、归档、最近续费历史。顶部筛选（全部 / 需处理 / 正常 / 已归档）。
- 提醒：**独立置顶小窗**（新 `BrowserWindow`，`focusable:false`、`skipTaskbar`、无边框透明），40px 大字号天数 + 主按钮「我续费了 · 顺延 30 天」+「稍后 / 今天不再提醒」，12 秒自动收起。
- 改动面：新增第三个 view 分支 + 新窗口生命周期 + 弹窗窗口的显示/回收；`window:view:set` 要支持 `renewals`；工作量最大。
- 适合：把「续费提醒」当成这个组件的第二主功能，要最强的提醒力度。
- 代价：改动面最大，回归风险最高；多一个窗口要处理置顶/关闭/单实例逻辑。

### 对比

| | A | B | C |
|---|---|---|---|
| 轨道是否重排版 | 否，只加信标 | 是，常驻订阅条 | 是，环形倒计时 + 三视图 |
| 不点开能否发现到期 | 弱（小信标） | 强（订阅条红点） | 最强（环形抢主体） |
| 提醒形态 | 组件内弹层 | 托盘气泡 + 整机红罩 | 独立置顶弹窗 |
| 账单全局视图 | 分组列表 | KPI + 30 天时间轴 | 环形卡 + 筛选 + 历史 |
| 实现工作量 | 1 | 1.5 | 2.4 |
| 回归风险 | 低 | 中 | 高 |

**我的建议：B 为主，把 C 的独立置顶弹窗作为可选提醒通道**（`settings.channels.popup`）—— 布局改造控制在轨道 + 抽屉，不动三视图；同时保留「弹窗」这个最强提醒。B 的时间轴和 C 的环形卡二选一时，时间轴更适合「多个账单谁先谁后」这类问题。

---

## 4. 实施顺序（选定方案后）

1. `src/main/subscription-store.js` —— 独立 JSON 存储 + CRUD + `renew()` 顺延语义 + 单元测试（`test/` 已是 `node --test`）。
2. `src/main/main.js` —— 60s 扫描器、状态跃迁判定、`subs:*` IPC、托盘角标/气泡。
3. `src/main/preload.js` —— 暴露 API。
4. `src/renderer/index.html` + `styles.css` —— 按选定方案改版，保留 `#remaining / #liquidFill / #statusDot` 等既有 id 契约。
5. `src/renderer/renderer.js` —— 订阅 Tab 渲染、表单、一键顺延、弹层；`STR.zh/en` 文案。
6. 回归：额度读取、7d/5h 切换、中转站汇总、抽屉展开动画、`npm test`、`npm run build`。

---

## 5. 需要你拍板的点

1. 选 A / B / C，还是 B + C 的弹窗通道。
2. 「3 天」「30 天」是否接受做成每项可配（默认 3/30）。我建议接受。
3. 点「已续费」后的顺延起算：**从今天起算**还是**从旧到期日起算**（我默认今天）。
4. 提醒通道优先级：轨道变红 / 组件内弹层 / 托盘气泡 / 独立置顶窗，哪些默认开。
5. 是否需要「月支出汇总」和「续费历史」（B、C 里有，A 里可加可不加）。
