# 快速設定指南

## 雲端按需運行設定（GitHub Actions）

**完全免費，無需伺服器！** 只需要在 GitHub Actions 頁面點擊按鈕即可觸發掃描。

### 第一步：推送程式碼到 GitHub

```bash
git add .
git commit -m "Add on-demand scan with Telegram notifications"
git push origin main
```

### 第二步：設定 Telegram Bot

1. **建立 Telegram Bot**
   - 在 Telegram 搜尋 `@BotFather`
   - 發送 `/newbot`
   - 依提示設定機器人名稱和使用者名稱
   - 儲存 Bot Token（格式：`123456789:ABCdefGHIjklMNOpqrsTUVwxyz`）

2. **取得 Chat ID**
   - 發送 `/start` 給你剛建立的機器人
   - 造訪：`https://api.telegram.org/bot<你的Token>/getUpdates`
   - 在回傳的 JSON 中找到 `"chat":{"id":123456789}`，這就是你的 Chat ID

3. **設定 GitHub Secrets**
   - 進入你的 GitHub 倉庫
   - 點擊 Settings → Secrets and variables → Actions
   - 點擊 "New repository secret"，新增以下 secrets：

   ```
   Name: TELEGRAM_BOT_TOKEN
   Value: 你的Bot Token
   
   Name: TELEGRAM_CHAT_ID
   Value: 你的Chat ID
   ```

### 第三步：觸發掃描

1. 在 GitHub 倉庫頁面，點擊 "Actions" 標籤
2. 選擇 "Futures Fakeout Scanner" workflow
3. 點擊右側 "Run workflow" 按鈕
4. 選擇分支（通常是 main），點擊綠色的 "Run workflow" 按鈕
5. 等待掃描完成（通常 1–2 分鐘）
6. 在 Telegram 收到掃描結果

## 本地測試通知

1. 複製 `.env.example` 為 `.env`
2. 填寫你的 Telegram Bot Token 和 Chat ID
3. 執行：`npm start`

## 注意事項

- GitHub Actions 免費版每月有 2000 分鐘運行時間限制
- 按需運行可節省運行時間，只在需要時執行
- 所有敏感資訊皆透過 GitHub Secrets 管理，不會洩漏
- 掃描結果僅供參考，不構成投資建議

## 故障排除

### 沒有收到通知

1. 檢查 GitHub Secrets 是否正確設定
2. 檢查 Telegram Bot Token 和 Chat ID 是否正確
3. 查看 GitHub Actions 日誌，檢查是否有錯誤
4. 確認 Bot 已啟動（發送 `/start` 給機器人）

### GitHub Actions 沒有運行

1. 檢查 workflow 檔案是否正確推送到倉庫
2. 在 Actions 頁面手動觸發測試
3. 檢查是否有權限問題
