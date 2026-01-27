# Futures Breakout Scanner

期货突破扫描器 - 自动扫描币安期货市场的突破机会

## 功能特点

- 🔍 自动扫描所有币安 USDT 期货交易对
- 📊 检测压缩形态和突破信号
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

   进入仓库的 Settings → Secrets and variables → Actions，添加：

   ```
   TELEGRAM_BOT_TOKEN=你的机器人Token
   TELEGRAM_CHAT_ID=你的Chat ID
   ```

4. **触发扫描**

   - 在 GitHub 仓库页面，点击 "Actions" 标签
   - 选择 "Futures Breakout Scanner" workflow
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

程序会检测以下条件：

1. **压缩形态**：价格在 25 根 4H K 线内波动范围小于 25%
2. **突破信号**：价格突破阻力位，成交量放大
3. **回测确认**：15 分钟级别回测阻力位后反弹

## 输出结果

扫描结果包含：
- 交易对符号
- 入场价格
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
