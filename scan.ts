import ccxt from "ccxt";
import * as readline from "node:readline";

/* =======================
   基本設定
======================= */

const exchange = new ccxt.binanceusdm({
  enableRateLimit: true,
});

async function getAllTradableSymbols(): Promise<string[]> {
  // Pull latest market list (symbols can change over time)
  await exchange.loadMarkets(true);

  const markets = exchange.markets ?? {};
  const symbols = Object.keys(markets).filter((symbol) => {
    const m: any = (markets as any)[symbol];
    if (!m) return false;

    // Prefer USDT-margined perpetual swaps on Binance USD-M
    const active = m.active !== false;
    const isSwap = m.swap === true;
    const linear = m.linear === true;
    const quoteIsUSDT = m.quote === "USDT";

    return active && isSwap && linear && quoteIsUSDT;
  });

  // Stable order for nicer diffs/logs
  symbols.sort();
  return symbols;
}

const COMPRESSION_RANGE_RATIO = 0.12;
const BREAKOUT_VOLUME_MULTIPLIER = 1.5;

/* =======================
   進度顯示
======================= */

function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0)
    return `${h}h${String(m).padStart(2, "0")}m${String(ss).padStart(2, "0")}s`;
  return `${m}m${String(ss).padStart(2, "0")}s`;
}

function renderProgressBar(done: number, total: number, width = 24): string {
  if (total <= 0) return `[${" ".repeat(width)}]`;
  const ratio = Math.min(1, Math.max(0, done / total));
  const filled = Math.round(ratio * width);
  return `[${"=".repeat(filled)}${" ".repeat(Math.max(0, width - filled))}]`;
}

function updateProgressLine(opts: {
  done: number;
  total: number;
  startedAtMs: number;
  currentSymbol?: string;
}) {
  if (!process.stdout.isTTY) return;

  const { done, total, startedAtMs, currentSymbol } = opts;
  const now = Date.now();
  const elapsedMs = now - startedAtMs;
  const pct = total > 0 ? ((done / total) * 100).toFixed(1) : "0.0";
  const rate = done > 0 ? done / Math.max(1, elapsedMs / 1000) : 0;
  const remaining = Math.max(0, total - done);
  const etaMs = rate > 0 ? (remaining / rate) * 1000 : 0;

  const line =
    `${renderProgressBar(done, total)} ` +
    `${done}/${total} (${pct}%) ` +
    `elapsed ${formatDuration(elapsedMs)} ` +
    (rate > 0 ? `ETA ${formatDuration(etaMs)} ` : "") +
    (currentSymbol ? `| ${currentSymbol}` : "");

  readline.clearLine(process.stdout, 0);
  readline.cursorTo(process.stdout, 0);
  process.stdout.write(line);
}

/* =======================
   型別
======================= */

interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/* =======================
   工具函式
======================= */

async function fetchOHLCV(
  symbol: string,
  timeframe: "15m" | "4h",
  limit = 200,
): Promise<Candle[]> {
  const raw = await exchange.fetchOHLCV(symbol, timeframe, undefined, limit);
  return raw.map((c) => ({
    timestamp: c[0] as number,
    open: c[1] as number,
    high: c[2] as number,
    low: c[3] as number,
    close: c[4] as number,
    volume: c[5] as number,
  }));
}

function sma(values: number[], period: number): number[] {
  return values.map((_, i) =>
    i < period
      ? NaN
      : values.slice(i - period, i).reduce((a, b) => a + b, 0) / period,
  );
}

/* =======================
   邏輯判斷
======================= */

// 盤整 / 收斂
function isCompression(candles: Candle[]): boolean {
  const recent = candles.slice(-40);
  const highs = recent.map((c) => c.high);
  const lows = recent.map((c) => c.low);

  const range = Math.max(...highs) - Math.min(...lows);

  const rangeRatio = range / recent[recent.length - 1].close;
  return rangeRatio < COMPRESSION_RANGE_RATIO;
}

// 放量突破
function isBreakout(candles: Candle[]): {
  ok: boolean;
  resistance: number;
} {
  const recent = candles.slice(-50);
  const last = recent[recent.length - 1];

  const resistance = Math.max(...recent.slice(0, -1).map((c) => c.high));

  const volumes = recent.map((c) => c.volume);
  const volMA = sma(volumes, 20);
  const volumeOK =
    last.volume > volMA[volMA.length - 1] * BREAKOUT_VOLUME_MULTIPLIER;

  const priceOK = last.close > resistance * 1.002;

  return {
    ok: priceOK && volumeOK,
    resistance,
  };
}

// 回踩確認
function isValidRetest(candles: Candle[], resistance: number): boolean {
  const last = candles[candles.length - 1];
  return last.low >= resistance * 0.995 && last.close > resistance;
}

/* =======================
   主流程
======================= */

async function scanSymbol(symbol: string) {
  try {
    const candles4h = await fetchOHLCV(symbol, "4h");

    if (!isCompression(candles4h)) return null;

    const breakout = isBreakout(candles4h);
    if (!breakout.ok) return null;

    const candles15m = await fetchOHLCV(symbol, "15m", 100);
    if (!isValidRetest(candles15m, breakout.resistance)) return null;

    return {
      symbol,
      resistance: breakout.resistance.toFixed(4),
      status: "BREAKOUT_CONFIRMED",
    };
  } catch (err) {
    console.error(`Error on ${symbol}`, err);
    return null;
  }
}

async function main() {
  console.log("Scanning futures market...\n");

  const symbols = await getAllTradableSymbols();
  console.log(`Loaded ${symbols.length} tradable symbols.\n`);

  const results = [];

  const startedAtMs = Date.now();
  let done = 0;
  updateProgressLine({ done, total: symbols.length, startedAtMs });

  for (const symbol of symbols) {
    const res = await scanSymbol(symbol);
    done += 1;
    updateProgressLine({
      done,
      total: symbols.length,
      startedAtMs,
      currentSymbol: symbol,
    });
    if (res) {
      results.push(res);
      console.log("FOUND:", res);
    }
  }

  if (process.stdout.isTTY) process.stdout.write("\n");

  if (results.length === 0) {
    console.log("No valid breakout found.");
  } else {
    console.log("\nSummary:");
    console.table(results);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
