# Futures Fakeout Scanner

期货假突破扫描器 - 自动扫描币安期货市场的假突破（多头陷阱）做空机会

## 功能特点

- 🔍 自动扫描所有币安 USDT 期货交易对
- 📊 检测假突破（刺穿阻力后收盘回落）+ 放量或射击之星确认
- 🔔 Telegram 通知支持
- ☁️ 支持 GitHub Actions 云端按需运行
- 💰 完全免费，无需服务器

## 本地运行

### 安装依赖

```bash
npm install
```

### 运行扫描

```bash
npm start
```

### 配置 Telegram 通知（可选）

创建 `.env` 文件（参考 `.env.example`）：

```
TELEGRAM_BOT_TOKEN=你的机器人Token
TELEGRAM_CHAT_ID=你的Chat ID
```

## 云端按需运行（GitHub Actions）

**无需服务器，完全免费！** 只需要在 GitHub Actions 页面点击按钮即可触发扫描。

### 设置步骤

1. **将代码推送到 GitHub 仓库**

2. **配置 Telegram Bot**

   - 在 Telegram 搜索 `@BotFather`
   - 发送 `/newbot` 创建新机器人
   - 获取 Bot Token
   - 发送 `/start` 给你的机器人
   - 访问 `https://api.telegram.org/bot<你的Token>/getUpdates` 获取 Chat ID

3. **配置 GitHub Secrets**

   进入仓库的 Settings → Secrets and variables → Actions，点击 "New repository secret" 添加：

   - `TELEGRAM_BOT_TOKEN`：你的机器人 Token
   - `TELEGRAM_CHAT_ID`：你的 Chat ID

4. **触发扫描**

   - 在 GitHub 仓库页面，点击 "Actions" 标签
   - 选择 "Futures Fakeout Scanner" workflow
   - 点击右侧 "Run workflow" 按钮
   - 选择分支（通常是 main），点击绿色的 "Run workflow" 按钮
   - 等待扫描完成，结果会通过 Telegram 发送给你

### 使用流程

1. 打开 GitHub 仓库 → Actions
2. 点击 "Run workflow" 按钮
3. 等待 1-2 分钟
4. 在 Telegram 收到扫描结果

就是这么简单！不需要任何服务器或持续运行的程序。

## 扫描策略

程序检测 **假突破做空**（多头陷阱）条件：

1. **阻力刺穿**：最近一根 4H K 线最高价曾刺穿过去 N 根内的阻力位（约 0.5% 以上）
2. **收盘回落**：该 K 线收盘价收在阻力位下方，形成假突破
3. **确认条件**：至少满足其一——**放量**（当根量为均量 1.2 倍以上）或 **射击之星**（上影线 ≥ 实体）

据此给出做空入场价、止损（设在假突破高点之上）、止盈（按风险回报比约 2:1）。

## 输出结果

扫描结果包含：
- 交易对符号
- 入场价格（做空）
- 止损价格
- 止盈价格

## 注意事项

- GitHub Actions 免费版每月有运行时间限制（2000 分钟）
- 按需运行可以节省运行时间，只在需要时运行
- 所有配置通过环境变量管理，不会泄露敏感信息
- 扫描结果仅供参考，不构成投资建议

## 开发

```bash
# 类型检查
npm run type-check

# 构建
npm run build

# 清理
npm run clean
```
