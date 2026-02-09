# 快速设置指南

## 云端按需运行设置（GitHub Actions）

**完全免费，无需服务器！** 只需要在 GitHub Actions 页面点击按钮即可触发扫描。

### 第一步：推送代码到 GitHub

```bash
git add .
git commit -m "Add on-demand scan with Telegram notifications"
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

### 第三步：触发扫描

1. 在 GitHub 仓库页面，点击 "Actions" 标签
2. 选择 "Futures Fakeout Scanner" workflow
3. 点击右侧 "Run workflow" 按钮
4. 选择分支（通常是 main），点击绿色的 "Run workflow" 按钮
5. 等待扫描完成（通常 1-2 分钟）
6. 在 Telegram 收到扫描结果

## 本地测试通知

1. 复制 `.env.example` 为 `.env`
2. 填写你的 Telegram Bot Token 和 Chat ID
3. 运行：`npm start`

## 注意事项

- GitHub Actions 免费版每月有 2000 分钟运行时间限制
- 按需运行可以节省运行时间，只在需要时运行
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
2. 在 Actions 页面手动触发测试
3. 检查是否有权限问题
