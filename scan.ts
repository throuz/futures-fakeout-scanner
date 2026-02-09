import ccxt from "ccxt";
import * as readline from "node:readline";
import { Notifier, type ScanResult } from "./notify";

const exchange = new ccxt.binanceusdm({
  enableRateLimit: true,
});

const CONFIG = {
  // 假突破做空 (Fakeout Short)
  FAKEOUT_LOOKBACK: 50,
  FAKEOUT_PIERCE_MULTIPLIER: 1.005, // 最高價需突破阻力多少才算「刺穿」
  FAKEOUT_STOP_ABOVE_HIGH: 1.002, // 止損設在假突破高點之上
  FAKEOUT_RISK_REWARD_RATIO: 2,
  FAKEOUT_VOLUME_MA_PERIOD: 20,
  FAKEOUT_VOLUME_MIN_MULTIPLIER: 1.2, // 當根 K 量至少為均量 1.2 倍（陷阱常伴隨放量）
  FAKEOUT_SHOOTING_STAR_BODY_RATIO: 1.0, // 上影線 >= 實體倍數時視為射擊之星
  FAKEOUT_REQUIRE_VOLUME_OR_SHOOTING_STAR: true, // 至少滿足：放量 或 射擊之星
  FAKEOUT_PREFER_1D_DOWNTREND: false, // 若 true 僅在日線空頭時出信號（送分題模式）
  CANDLE_4H_LIMIT: 200,
  CANDLE_15M_LIMIT: 100,
  CANDLE_1D_LIMIT: 60,
  PROGRESS_BAR_WIDTH: 24,
  PROGRESS_UPDATE_INTERVAL_MS: 100,
  CONCURRENCY_LIMIT: 10,
} as const;

interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

async function getAllTradableSymbols(): Promise<string[]> {
  await exchange.loadMarkets(true);
  const markets = exchange.markets ?? {};
  const symbols = Object.keys(markets).filter((symbol) => {
    const m: any = (markets as any)[symbol];
    if (!m) return false;
    return (
      m.active !== false &&
      m.swap === true &&
      m.linear === true &&
      m.quote === "USDT"
    );
  });
  symbols.sort();
  return symbols;
}

function formatSymbolDisplay(symbol: string): string {
  return symbol.split(":")[0];
}

function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0)
    return `${h}h${String(m).padStart(2, "0")}m${String(ss).padStart(2, "0")}s`;
  return `${m}m${String(ss).padStart(2, "0")}s`;
}

function renderProgressBar(
  done: number,
  total: number,
  width = CONFIG.PROGRESS_BAR_WIDTH,
): string {
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
    (currentSymbol ? `| ${formatSymbolDisplay(currentSymbol)}` : "");

  readline.clearLine(process.stdout, 0);
  readline.cursorTo(process.stdout, 0);
  process.stdout.write(line);
}

async function fetchOHLCV(
  symbol: string,
  timeframe: "15m" | "4h" | "1d",
  limit?: number,
): Promise<Candle[]> {
  const defaultLimit =
    timeframe === "4h"
      ? CONFIG.CANDLE_4H_LIMIT
      : timeframe === "1d"
        ? CONFIG.CANDLE_1D_LIMIT
        : CONFIG.CANDLE_15M_LIMIT;
  const actualLimit = limit ?? defaultLimit;
  const raw = await exchange.fetchOHLCV(
    symbol,
    timeframe,
    undefined,
    actualLimit,
  );
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
  const result: number[] = new Array(values.length);
  for (let i = 0; i < period && i < values.length; i++) {
    result[i] = NaN;
  }
  if (values.length > period) {
    let sum = 0;
    for (let i = 0; i < period; i++) {
      sum += values[i];
    }
    result[period] = sum / period;
    for (let i = period + 1; i < values.length; i++) {
      sum = sum - values[i - period - 1] + values[i - 1];
      result[i] = sum / period;
    }
  }
  return result;
}

/** 多頭陷阱特徵：過去 N 根最高價當阻力，最後一根曾刺穿但收盤跌回下方 */
function isPotentialTrap(candles: Candle[]): {
  ok: boolean;
  resistance: number;
  last: Candle;
  volumeOK: boolean;
  shootingStar: boolean;
} {
  const recent = candles.slice(-CONFIG.FAKEOUT_LOOKBACK);
  if (recent.length < 2) {
    return {
      ok: false,
      resistance: 0,
      last: candles[candles.length - 1],
      volumeOK: false,
      shootingStar: false,
    };
  }
  const last = recent[recent.length - 1];
  let resistance = 0;
  for (let i = 0; i < recent.length - 1; i++) {
    if (recent[i].high > resistance) resistance = recent[i].high;
  }
  const hasPierced = last.high > resistance * CONFIG.FAKEOUT_PIERCE_MULTIPLIER;
  const hasFailed = last.close < resistance;
  const volumes = recent.map((c) => c.volume);
  const volMA = sma(volumes, CONFIG.FAKEOUT_VOLUME_MA_PERIOD);
  const volLast = volMA[volMA.length - 1];
  const volumeOK =
    !Number.isNaN(volLast) &&
    volLast > 0 &&
    last.volume >= volLast * CONFIG.FAKEOUT_VOLUME_MIN_MULTIPLIER;
  const body = Math.abs(last.close - last.open);
  const upperShadow = last.high - Math.max(last.open, last.close);
  const shootingStar =
    body > 0 &&
    upperShadow >= body * CONFIG.FAKEOUT_SHOOTING_STAR_BODY_RATIO;

  return {
    ok: hasPierced && hasFailed,
    resistance,
    last,
    volumeOK,
    shootingStar,
  };
}

/** 日線是否為空頭趨勢（收盤價在 20 日均線下方，利於 4H 假突破做空） */
function is1DDowntrend(candles: Candle[]): boolean {
  if (candles.length < 21) return false;
  const closes = candles.map((c) => c.close);
  const ma20 = sma(closes, 20);
  const lastMA = ma20[ma20.length - 1];
  const lastClose = candles[candles.length - 1].close;
  return !Number.isNaN(lastMA) && lastClose < lastMA;
}

async function pMap<T, R>(
  items: T[],
  mapper: (item: T, index: number) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const currentIndex = nextIndex++;
      if (currentIndex >= items.length) break;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  const workers: Promise<void>[] = [];
  for (let i = 0; i < workerCount; i++) {
    workers.push(worker());
  }

  await Promise.all(workers);
  return results;
}

/** 掃描單一標的：獵殺假突破做空（4H 誘多失敗 + 15m 陰線確認） */
async function scanSymbol(symbol: string): Promise<{
  symbol: string;
  entryPrice: string;
  stopLoss: string;
  takeProfit: string;
} | null> {
  try {
    const candles4h = await fetchOHLCV(symbol, "4h");
    const trap = isPotentialTrap(candles4h);
    if (!trap.ok) return null;
    if (
      CONFIG.FAKEOUT_REQUIRE_VOLUME_OR_SHOOTING_STAR &&
      !trap.volumeOK &&
      !trap.shootingStar
    )
      return null;
    if (CONFIG.FAKEOUT_PREFER_1D_DOWNTREND) {
      const candles1d = await fetchOHLCV(symbol, "1d");
      if (!is1DDowntrend(candles1d)) return null;
    }

    // 15m 確認下跌動能：最後一根為陰線
    const candles15m = await fetchOHLCV(symbol, "15m");
    const last15m = candles15m[candles15m.length - 1];
    if (last15m.close >= last15m.open) return null;

    const entry = last15m.close;
    const stopLoss = trap.last.high * CONFIG.FAKEOUT_STOP_ABOVE_HIGH;
    const risk = stopLoss - entry;
    const takeProfit = entry - risk * CONFIG.FAKEOUT_RISK_REWARD_RATIO;

    return {
      symbol: formatSymbolDisplay(symbol),
      entryPrice: entry.toFixed(4),
      stopLoss: stopLoss.toFixed(4),
      takeProfit: takeProfit.toFixed(4),
    };
  } catch (err) {
    return null;
  }
}

async function main() {
  const symbols = await getAllTradableSymbols();
  const startedAtMs = Date.now();
  let done = 0;

  updateProgressLine({ done, total: symbols.length, startedAtMs });

  const progressInterval = setInterval(() => {
    updateProgressLine({
      done,
      total: symbols.length,
      startedAtMs,
    });
  }, CONFIG.PROGRESS_UPDATE_INTERVAL_MS);

  const scanResults = await pMap(
    symbols,
    async (symbol) => {
      const result = await scanSymbol(symbol);
      done += 1;
      return result;
    },
    CONFIG.CONCURRENCY_LIMIT,
  );

  clearInterval(progressInterval);
  updateProgressLine({
    done: symbols.length,
    total: symbols.length,
    startedAtMs,
  });

  if (process.stdout.isTTY) process.stdout.write("\n");

  const results = scanResults.filter((r) => r !== null) as ScanResult[];

  if (results.length === 0) {
    console.log(`未找到符合條件的假突破做空機會`);
  } else {
    console.log(`找到 ${results.length} 個符合條件的假突破做空機會:\n`);
    console.table(results);
  }

  // 发送通知
  const notifier = new Notifier();
  await notifier.notify(results);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
