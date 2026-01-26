interface NotificationConfig {
  email?: {
    enabled: boolean;
    smtp: {
      host: string;
      port: number;
      secure: boolean;
      auth: {
        user: string;
        pass: string;
      };
    };
    to: string;
  };
  telegram?: {
    enabled: boolean;
    botToken: string;
    chatId: string;
  };
  webhook?: {
    enabled: boolean;
    url: string;
  };
}

interface ScanResult {
  symbol: string;
  entryPrice: string;
  stopLoss: string;
  takeProfit: string;
}

class Notifier {
  private config: NotificationConfig;

  constructor() {
    this.config = this.loadConfig();
  }

  private loadConfig(): NotificationConfig {
    const config: NotificationConfig = {};

    // Email configuration
    if (process.env.EMAIL_ENABLED === "true") {
      config.email = {
        enabled: true,
        smtp: {
          host: process.env.SMTP_HOST || "",
          port: parseInt(process.env.SMTP_PORT || "587"),
          secure: process.env.SMTP_SECURE === "true",
          auth: {
            user: process.env.SMTP_USER || "",
            pass: process.env.SMTP_PASS || "",
          },
        },
        to: process.env.EMAIL_TO || "",
      };
    }

    // Telegram configuration
    if (process.env.TELEGRAM_ENABLED === "true") {
      config.telegram = {
        enabled: true,
        botToken: process.env.TELEGRAM_BOT_TOKEN || "",
        chatId: process.env.TELEGRAM_CHAT_ID || "",
      };
    }

    // Webhook configuration
    if (process.env.WEBHOOK_ENABLED === "true") {
      config.webhook = {
        enabled: true,
        url: process.env.WEBHOOK_URL || "",
      };
    }

    return config;
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

  private formatPlainMessage(results: ScanResult[]): string {
    if (results.length === 0) {
      return "📊 扫描完成：未找到符合条件的突破机会";
    }

    let message = `🚀 找到 ${results.length} 個符合條件的突破機會：\n\n`;
    results.forEach((result, index) => {
      message += `${index + 1}. ${result.symbol}\n`;
      message += `   入場價: ${result.entryPrice}\n`;
      message += `   止損: ${result.stopLoss}\n`;
      message += `   止盈: ${result.takeProfit}\n\n`;
    });

    return message;
  }

  async sendEmail(results: ScanResult[]): Promise<void> {
    if (!this.config.email?.enabled) return;

    try {
      const message = this.formatPlainMessage(results);
      const subject = results.length > 0
        ? `🚀 找到 ${results.length} 個突破機會`
        : "📊 掃描完成：無突破機會";

      // 使用简单的 HTTP API 发送邮件（如 SendGrid, Mailgun）
      // 或者可以安装 nodemailer: npm install nodemailer @types/nodemailer
      if (this.config.webhook?.enabled && this.config.webhook.url.includes("mail")) {
        // 如果配置了邮件 webhook，使用 webhook
        await this.sendWebhook(results);
      } else {
        console.log("Email notification would be sent:", subject);
        console.log(message);
        console.log("\n提示：要启用邮件发送，请安装 nodemailer 或配置邮件 webhook");
      }
    } catch (error) {
      console.error("Failed to send email:", error);
    }
  }

  async sendTelegram(results: ScanResult[]): Promise<void> {
    if (!this.config.telegram?.enabled) return;

    try {
      const message = this.formatMessage(results);
      const url = `https://api.telegram.org/bot${this.config.telegram.botToken}/sendMessage`;

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          chat_id: this.config.telegram.chatId,
          text: message,
          parse_mode: "HTML",
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Telegram API error: ${error}`);
      }

      console.log("Telegram notification sent successfully");
    } catch (error) {
      console.error("Failed to send Telegram notification:", error);
    }
  }

  async sendWebhook(results: ScanResult[]): Promise<void> {
    if (!this.config.webhook?.enabled) return;

    try {
      const payload = {
        timestamp: new Date().toISOString(),
        count: results.length,
        results: results,
      };

      const response = await fetch(this.config.webhook.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Webhook error: ${error}`);
      }

      console.log("Webhook notification sent successfully");
    } catch (error) {
      console.error("Failed to send webhook notification:", error);
    }
  }

  async notify(results: ScanResult[]): Promise<void> {
    const promises: Promise<void>[] = [];

    if (this.config.email?.enabled) {
      promises.push(this.sendEmail(results));
    }

    if (this.config.telegram?.enabled) {
      promises.push(this.sendTelegram(results));
    }

    if (this.config.webhook?.enabled) {
      promises.push(this.sendWebhook(results));
    }

    await Promise.allSettled(promises);
  }
}

export { Notifier, type ScanResult };
