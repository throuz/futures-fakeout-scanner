# 快速设置指南

## 云端自动运行设置（GitHub Actions）

### 第一步：推送代码到 GitHub

```bash
git add .
git commit -m "Add auto-scan with Telegram notifications"
git push origin main
```

### 第二步：配置 Telegram Bot

1. **创建 Telegram Bot**
   - 在 Telegram 搜索 `@BotFather`
   - 发送 `/newbot`
   - 按提示设置机器人名称和用户名
   - 保存 Bot Token（格式：`123456789:ABCdefGHIjklMNOpqrsTUVwxyz`）

2. **获取 Chat ID**
   - 发送 `/start` 给你刚创建的机器人
   - 访问：`https://api.telegram.org/bot<你的Token>/getUpdates`
   - 在返回的 JSON 中找到 `"chat":{"id":123456789}`，这就是你的 Chat ID

3. **配置 GitHub Secrets**
   - 进入你的 GitHub 仓库
   - 点击 Settings → Secrets and variables → Actions
   - 点击 "New repository secret"，添加以下 secrets：

   ```
   Name: TELEGRAM_BOT_TOKEN
   Value: 你的Bot Token
   
   Name: TELEGRAM_CHAT_ID
   Value: 你的Chat ID
   ```

### 第三步：调整扫描频率（可选）

编辑 `.github/workflows/scan.yml`，修改 cron 表达式：

```yaml
# 每 4 小时运行一次（默认）
- cron: "0 */4 * * *"

# 每 2 小时运行一次
- cron: "0 */2 * * *"

# 每天 UTC 8:00 运行
- cron: "0 8 * * *"

# 每 6 小时运行一次
- cron: "0 */6 * * *"
```

### 第四步：测试运行

1. 在 GitHub 仓库页面，点击 "Actions" 标签
2. 选择 "Futures Breakout Scanner" workflow
3. 点击 "Run workflow" 手动触发一次测试
4. 检查是否收到 Telegram 通知

## 本地测试通知

1. 复制 `.env.example` 为 `.env`
2. 填写你的 Telegram Bot Token 和 Chat ID
3. 运行：`npm start`

## 注意事项

- GitHub Actions 免费版每月有 2000 分钟运行时间限制
- 建议扫描频率不要超过每小时一次
- 所有敏感信息都通过 GitHub Secrets 管理，不会泄露
- 扫描结果仅供参考，不构成投资建议

## 故障排查

### 没有收到通知

1. 检查 GitHub Secrets 是否正确配置
2. 检查 Telegram Bot Token 和 Chat ID 是否正确
3. 查看 GitHub Actions 日志，检查是否有错误
4. 确认 Bot 已启动（发送 `/start` 给机器人）

### GitHub Actions 没有运行

1. 检查 workflow 文件是否正确推送到仓库
2. 检查 cron 表达式是否正确
3. 可以在 Actions 页面手动触发测试
