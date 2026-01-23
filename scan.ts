import ccxt from "ccxt";

/* =======================
   基本設定
======================= */

const exchange = new ccxt.binanceusdm({
  enableRateLimit: true,
});

const SYMBOLS = [
  "BTC/USDT",
  "ETH/USDT",
  "SOL/USDT",
  "AVAX/USDT",
  "LINK/USDT",
  "BNB/USDT",
  "OP/USDT",
  "ARB/USDT",
];

const COMPRESSION_RANGE_RATIO = 0.12;
const BREAKOUT_VOLUME_MULTIPLIER = 1.5;

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
    timestamp: c[0],
    open: c[1],
    high: c[2],
    low: c[3],
    close: c[4],
    volume: c[5],
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

  const results = [];

  for (const symbol of SYMBOLS) {
    const res = await scanSymbol(symbol);
    if (res) {
      results.push(res);
      console.log("FOUND:", res);
    }
  }

  if (results.length === 0) {
    console.log("No valid breakout found.");
  } else {
    console.log("\nSummary:");
    console.table(results);
  }
}

main();
