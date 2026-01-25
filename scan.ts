import ccxt from "ccxt";
import * as readline from "node:readline";

const exchange = new ccxt.binanceusdm({
  enableRateLimit: true,
});

const CONFIG = {
  COMPRESSION_RANGE_RATIO: 0.25,
  COMPRESSION_CANDLE_COUNT: 25,
  BREAKOUT_CANDLE_COUNT: 50,
  BREAKOUT_VOLUME_MULTIPLIER: 1.1,
  BREAKOUT_VOLUME_MA_PERIOD: 20,
  BREAKOUT_PRICE_MULTIPLIER: 1.0005,
  RETEST_LOW_MULTIPLIER: 0.97,
  STOP_LOSS_METHOD: "resistance_below" as
    | "resistance_below"
    | "compression_low"
    | "atr",
  STOP_LOSS_BELOW_RESISTANCE: 0.02,
  TAKE_PROFIT_RISK_REWARD_RATIO: 2.5,
  CANDLE_4H_LIMIT: 200,
  CANDLE_15M_LIMIT: 100,
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
  timeframe: "15m" | "4h",
  limit?: number,
): Promise<Candle[]> {
  const defaultLimit =
    timeframe === "4h" ? CONFIG.CANDLE_4H_LIMIT : CONFIG.CANDLE_15M_LIMIT;
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

function isCompression(candles: Candle[]): boolean {
  const recent = candles.slice(-CONFIG.COMPRESSION_CANDLE_COUNT);
  let maxHigh = recent[0].high;
  let minLow = recent[0].low;
  for (let i = 1; i < recent.length; i++) {
    if (recent[i].high > maxHigh) maxHigh = recent[i].high;
    if (recent[i].low < minLow) minLow = recent[i].low;
  }
  const range = maxHigh - minLow;
  const rangeRatio = range / recent[recent.length - 1].close;
  return rangeRatio < CONFIG.COMPRESSION_RANGE_RATIO;
}

function isBreakout(candles: Candle[]): {
  ok: boolean;
  resistance: number;
} {
  const recent = candles.slice(-CONFIG.BREAKOUT_CANDLE_COUNT);
  const last = recent[recent.length - 1];
  let resistance = 0;
  for (let i = 0; i < recent.length - 1; i++) {
    if (recent[i].high > resistance) {
      resistance = recent[i].high;
    }
  }
  const volumes = recent.map((c) => c.volume);
  const volMA = sma(volumes, CONFIG.BREAKOUT_VOLUME_MA_PERIOD);
  const volumeOK =
    last.volume > volMA[volMA.length - 1] * CONFIG.BREAKOUT_VOLUME_MULTIPLIER;
  const priceOK = last.close > resistance * CONFIG.BREAKOUT_PRICE_MULTIPLIER;
  return {
    ok: priceOK && volumeOK,
    resistance,
  };
}

function isValidRetest(candles: Candle[], resistance: number): boolean {
  const last = candles[candles.length - 1];
  return (
    last.low >= resistance * CONFIG.RETEST_LOW_MULTIPLIER &&
    last.close > resistance
  );
}

function calculateATR(candles: Candle[], period: number = 14): number {
  if (candles.length < period + 1) return 0;
  const trueRanges: number[] = [];
  for (let i = candles.length - period; i < candles.length; i++) {
    const current = candles[i];
    const previous = candles[i - 1];
    const tr = Math.max(
      current.high - current.low,
      Math.abs(current.high - previous.close),
      Math.abs(current.low - previous.close),
    );
    trueRanges.push(tr);
  }
  return trueRanges.reduce((sum, tr) => sum + tr, 0) / trueRanges.length;
}

function calculateStopLossAndTakeProfit(
  entryPrice: number,
  resistance: number,
  compressionLow?: number,
  candles?: Candle[],
): {
  stopLoss: number;
  takeProfit: number;
} {
  let stopLoss: number;

  switch (CONFIG.STOP_LOSS_METHOD) {
    case "compression_low":
      if (compressionLow === undefined) {
        stopLoss = resistance * (1 - CONFIG.STOP_LOSS_BELOW_RESISTANCE);
      } else {
        stopLoss = compressionLow * 0.99;
      }
      break;
    case "atr":
      if (!candles || candles.length < 15) {
        stopLoss = resistance * (1 - CONFIG.STOP_LOSS_BELOW_RESISTANCE);
      } else {
        const atr = calculateATR(candles, 14);
        stopLoss = entryPrice - atr * 2.0;
      }
      break;
    case "resistance_below":
    default:
      const distanceFromResistance = (entryPrice - resistance) / resistance;
      const bufferMultiplier = distanceFromResistance < 0.01 ? 1.5 : 1.0;
      stopLoss =
        resistance * (1 - CONFIG.STOP_LOSS_BELOW_RESISTANCE * bufferMultiplier);
      break;
  }

  stopLoss = Math.min(stopLoss, entryPrice * 0.99);
  const risk = entryPrice - stopLoss;
  const takeProfit = entryPrice + risk * CONFIG.TAKE_PROFIT_RISK_REWARD_RATIO;

  return {
    stopLoss,
    takeProfit,
  };
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

async function scanSymbol(symbol: string): Promise<{
  symbol: string;
  entryPrice: string;
  stopLoss: string;
  takeProfit: string;
} | null> {
  try {
    const candles4h = await fetchOHLCV(symbol, "4h");
    if (!isCompression(candles4h)) return null;

    const breakout = isBreakout(candles4h);
    if (!breakout.ok) return null;

    const candles15m = await fetchOHLCV(symbol, "15m");
    if (!isValidRetest(candles15m, breakout.resistance)) return null;

    const recent4h = candles4h.slice(-CONFIG.COMPRESSION_CANDLE_COUNT);
    let compressionLow = recent4h[0].low;
    for (let i = 1; i < recent4h.length; i++) {
      if (recent4h[i].low < compressionLow) {
        compressionLow = recent4h[i].low;
      }
    }

    const entryPrice = candles15m[candles15m.length - 1].close;
    const sltp = calculateStopLossAndTakeProfit(
      entryPrice,
      breakout.resistance,
      compressionLow,
      candles4h,
    );

    return {
      symbol: formatSymbolDisplay(symbol),
      entryPrice: entryPrice.toFixed(4),
      stopLoss: sltp.stopLoss.toFixed(4),
      takeProfit: sltp.takeProfit.toFixed(4),
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

  const results = scanResults.filter((r) => r !== null);

  if (results.length === 0) {
    console.log(`未找到符合條件的突破機會`);
  } else {
    console.log(`找到 ${results.length} 個符合條件的突破機會:\n`);
    console.table(results);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
