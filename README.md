# ChatGPT Quota Widget

这是 `baiyeyshsbsu` 维护的 Windows 桌面额度悬浮组件，用于读取本机 ChatGPT 登录账号的 7 天额度，并管理多个本地账号记录。

## 当前功能

- 显示 7 天剩余额度、重置时间和套餐类型
- 红、黄、绿状态提示与手动刷新
- 自动识别当前 ChatGPT 登录账号
- 多账号本地管理，当前账号自动置顶
- 每页最多显示 5 个账号，窗口高度随账号数量变化
- 账号额度连续点击 5 次可进行人工矫正，重置周期变化或主动识别后恢复自动读数
- 本地保存可重置次数，不保存完整邮箱或认证 Token
- 窗口置顶、关闭时隐藏到系统托盘，仅托盘菜单执行彻底退出
- 区分网络/代理、登录状态、本机组件和服务响应错误，临时失败时保留最后读数
- 中文和英文界面

本项目仅在用户手动启动时运行。

## 本地运行

```powershell
npm install
npm start
```

也可以直接双击项目根目录的 `start.bat`。

## 打包

```powershell
npm run build
```

便携版输出到 `dist` 目录。

## 数据与隐私

账号记录保存在 Electron 的本机 `userData/store.json` 中。多账号匹配仅保存邮箱哈希和脱敏提示；额度数据不会由本项目上传到第三方服务。

## 项目信息

- 维护者：`baiyeyshsbsu`
- 仓库：<https://github.com/baiyeyshsbsu/chatgpt-quota-widget>
- 许可：MIT（见 `LICENSE`）
