interface ScanResult {
  symbol: string;
  entryPrice: string;
  stopLoss: string;
  takeProfit: string;
}

class Notifier {
  private botToken: string;
  private chatId: string;

  constructor() {
    this.botToken = process.env.TELEGRAM_BOT_TOKEN || "";
    this.chatId = process.env.TELEGRAM_CHAT_ID || "";
  }

  private formatMessage(results: ScanResult[]): string {
    if (results.length === 0) {
      return "📊 扫描完成：未找到符合条件的突破机会";
    }

    let message = `🚀 <b>找到 ${results.length} 個符合條件的突破機會</b>\n\n`;
    results.forEach((result, index) => {
      message += `<b>${index + 1}. ${result.symbol}</b>\n`;
      message += `   入場價: <code>${result.entryPrice}</code>\n`;
      message += `   止損: <code>${result.stopLoss}</code>\n`;
      message += `   止盈: <code>${result.takeProfit}</code>\n\n`;
    });

    return message;
  }

  async sendTelegram(results: ScanResult[]): Promise<void> {
    if (!this.botToken || !this.chatId) {
      console.log("Telegram 通知未配置，跳过发送");
      return;
    }

    try {
      const message = this.formatMessage(results);
      const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          chat_id: this.chatId,
          text: message,
          parse_mode: "HTML",
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Telegram API error: ${error}`);
      }

      console.log("Telegram 通知发送成功");
    } catch (error) {
      console.error("发送 Telegram 通知失败:", error);
    }
  }

  async notify(results: ScanResult[]): Promise<void> {
    await this.sendTelegram(results);
  }
}

export { Notifier, type ScanResult };
