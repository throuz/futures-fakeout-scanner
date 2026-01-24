import ccxt from "ccxt";
import * as readline from "node:readline";

/* =======================
   基本設定
======================= */

const exchange = new ccxt.binanceusdm({
  enableRateLimit: true,
});

/* =======================
   可調參數配置
   
   放寬標準建議：
   - 如果大部分標的在「盤整檢查」被過濾 → 增加 COMPRESSION_RANGE_RATIO (例如: 0.15-0.20)
   - 如果大部分標的在「突破檢查」被過濾 → 
     * 降低 BREAKOUT_VOLUME_MULTIPLIER (例如: 1.2-1.3)
     * 降低 BREAKOUT_PRICE_MULTIPLIER (例如: 1.001 = 0.1%)
   - 如果大部分標的在「回踩檢查」被過濾 → 降低 RETEST_LOW_MULTIPLIER (例如: 0.99-0.992)
======================= */

const CONFIG = {
  // ===== 盤整檢查參數 =====
  /**
   * 盤整檢查：最近N根K線的範圍比例需小於此值才算盤整
   * 當前: 0.25 (25%) - 範圍越小越嚴格
   * 放寬: 0.15-0.20 (15%-20%) - 允許更大的價格波動範圍
   */
  COMPRESSION_RANGE_RATIO: 0.25,
  /**
   * 盤整檢查：使用最近多少根4h K線來判斷盤整
   * 當前: 25根 (約4.2天)
   * 放寬: 30-35根 - 縮短判斷週期，更容易符合
   */
  COMPRESSION_CANDLE_COUNT: 25,

  // ===== 突破檢查參數 =====
  /**
   * 突破檢查：使用最近多少根4h K線來計算阻力位
   * 當前: 50根 (約8.3天)
   * 通常不需要調整
   */
  BREAKOUT_CANDLE_COUNT: 50,
  /**
   * 突破檢查：成交量需大於平均成交量的多少倍才算放量
   * 當前: 1.1倍 - 倍數越高越嚴格
   * 放寬: 1.2-1.3倍 - 降低成交量要求
   */
  BREAKOUT_VOLUME_MULTIPLIER: 1.1,
  /**
   * 突破檢查：成交量移動平均線的週期
   * 當前: 20根
   * 通常不需要調整
   */
  BREAKOUT_VOLUME_MA_PERIOD: 20,
  /**
   * 突破檢查：收盤價需大於阻力位的多少倍才算突破
   * 當前: 1.0005 (0.05%) - 倍數越高越嚴格
   * 放寬: 1.001 (0.1%) - 降低突破幅度要求
   */
  BREAKOUT_PRICE_MULTIPLIER: 1.0005,

  // ===== 回踩檢查參數 =====
  /**
   * 回踩檢查：低點需大於等於阻力位的多少倍
   * 當前: 0.97 (97%) - 允許回踩到阻力位下方3%
   * 放寬: 0.99-0.992 (99%-99.2%) - 允許更深的回踩
   */
  RETEST_LOW_MULTIPLIER: 0.97,
  /** 回踩檢查：收盤價需大於阻力位 */

  // ===== 止盈止損參數 =====
  /**
   * 止損方式：
   * - "resistance_below": 止損設在阻力位下方（推薦用於突破策略）
   * - "compression_low": 止損設在盤整區間最低點下方
   * - "atr": 基於ATR動態止損
   */
  STOP_LOSS_METHOD: "resistance_below" as
    | "resistance_below"
    | "compression_low"
    | "atr",
  /**
   * 止損：阻力位下方的百分比（當 STOP_LOSS_METHOD = "resistance_below" 時使用）
   * 例如: 0.02 = 阻力位下方2%
   */
  STOP_LOSS_BELOW_RESISTANCE: 0.02,
  /**
   * 止盈：風險回報比（止盈距離 / 止損距離）
   * 例如: 2.0 = 止盈距離是止損距離的2倍（2:1風險回報比）
   * 例如: 3.0 = 止盈距離是止損距離的3倍（3:1風險回報比）
   */
  TAKE_PROFIT_RISK_REWARD_RATIO: 2.5,
  /**
   * 是否啟用追蹤止損
   * true: 價格上漲後，止損會跟隨上移（保護利潤）
   * false: 固定止損
   */
  USE_TRAILING_STOP: true,
  /**
   * 追蹤止損：當價格上漲多少百分比後，開始啟用追蹤止損
   * 例如: 0.03 = 當價格上漲3%後，開始追蹤止損
   */
  TRAILING_STOP_ACTIVATION: 0.03,
  /**
   * 追蹤止損：止損跟隨價格的距離（百分比）
   * 例如: 0.015 = 止損設在最高價下方1.5%
   */
  TRAILING_STOP_DISTANCE: 0.015,

  // ===== K線數據參數 =====
  /** 4h K線：獲取多少根K線數據 */
  CANDLE_4H_LIMIT: 200,
  /** 15m K線：獲取多少根K線數據 */
  CANDLE_15M_LIMIT: 100,

  // ===== UI顯示參數 =====
  /** 進度條寬度（字符數） */
  PROGRESS_BAR_WIDTH: 24,

  // ===== 效能參數 =====
  /** 並行處理的標的數量（同時處理多少個標的）
   * 注意：如果 enableRateLimit 為 true，ccxt 會自動控制速率，
   * 過高的並發數可能不會提升速度，反而會增加等待時間
   */
  CONCURRENCY_LIMIT: 10,
  /** 進度更新間隔（毫秒）- 降低更新頻率以減少 I/O 開銷 */
  PROGRESS_UPDATE_INTERVAL_MS: 100,
} as const;

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

  // 前 period 個元素為 NaN
  for (let i = 0; i < period && i < values.length; i++) {
    result[i] = NaN;
  }

  // 計算第一個有效值
  if (values.length > period) {
    let sum = 0;
    for (let i = 0; i < period; i++) {
      sum += values[i];
    }
    result[period] = sum / period;

    // 使用滑動窗口計算後續值（O(n) 而非 O(n²)）
    for (let i = period + 1; i < values.length; i++) {
      sum = sum - values[i - period - 1] + values[i - 1];
      result[i] = sum / period;
    }
  }

  return result;
}

/* =======================
   邏輯判斷
======================= */

// 盤整 / 收斂
function isCompression(candles: Candle[]): boolean {
  const recent = candles.slice(-CONFIG.COMPRESSION_CANDLE_COUNT);

  // 單次遍歷找出最高和最低
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

// 放量突破
function isBreakout(candles: Candle[]): {
  ok: boolean;
  resistance: number;
} {
  const recent = candles.slice(-CONFIG.BREAKOUT_CANDLE_COUNT);
  const last = recent[recent.length - 1];

  // 計算阻力位（排除最後一根K線）
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

// 回踩確認
function isValidRetest(candles: Candle[], resistance: number): boolean {
  const last = candles[candles.length - 1];
  return (
    last.low >= resistance * CONFIG.RETEST_LOW_MULTIPLIER &&
    last.close > resistance
  );
}

// 計算 ATR (Average True Range)
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

// 計算止盈止損
function calculateStopLossAndTakeProfit(
  entryPrice: number,
  resistance: number,
  compressionLow?: number,
  candles?: Candle[],
): {
  stopLoss: number;
  takeProfit: number;
  riskRewardRatio: number;
  stopLossMethod: string;
} {
  let stopLoss: number;
  let stopLossMethod: string;

  switch (CONFIG.STOP_LOSS_METHOD) {
    case "compression_low":
      if (compressionLow === undefined) {
        // 如果沒有提供盤整低點，回退到阻力位下方
        stopLoss = resistance * (1 - CONFIG.STOP_LOSS_BELOW_RESISTANCE);
        stopLossMethod = "resistance_below (fallback)";
      } else {
        stopLoss = compressionLow * 0.995; // 盤整低點下方0.5%
        stopLossMethod = "compression_low";
      }
      break;

    case "atr":
      if (!candles || candles.length < 15) {
        // 如果沒有足夠的K線數據，回退到阻力位下方
        stopLoss = resistance * (1 - CONFIG.STOP_LOSS_BELOW_RESISTANCE);
        stopLossMethod = "resistance_below (fallback)";
      } else {
        const atr = calculateATR(candles, 14);
        stopLoss = entryPrice - atr * 1.5; // 入場價下方1.5倍ATR
        stopLossMethod = "atr";
      }
      break;

    case "resistance_below":
    default:
      stopLoss = resistance * (1 - CONFIG.STOP_LOSS_BELOW_RESISTANCE);
      stopLossMethod = "resistance_below";
      break;
  }

  // 確保止損不會高於入場價（做多時）
  stopLoss = Math.min(stopLoss, entryPrice * 0.99);

  // 計算止盈（基於風險回報比）
  const risk = entryPrice - stopLoss;
  const takeProfit = entryPrice + risk * CONFIG.TAKE_PROFIT_RISK_REWARD_RATIO;

  // 計算實際風險回報比
  const actualReward = takeProfit - entryPrice;
  const actualRiskRewardRatio =
    risk > 0 ? actualReward / risk : CONFIG.TAKE_PROFIT_RISK_REWARD_RATIO;

  return {
    stopLoss,
    takeProfit,
    riskRewardRatio: actualRiskRewardRatio,
    stopLossMethod,
  };
}

/* =======================
   並行處理工具
======================= */

/**
 * 並行處理陣列，控制並發數量
 */
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

/* =======================
   主流程
======================= */

async function scanSymbol(symbol: string): Promise<{
  result: {
    symbol: string;
    entryPrice: string;
    stopLoss: string;
    takeProfit: string;
  } | null;
  stage: "compression" | "breakout" | "retest" | "error" | "success";
}> {
  try {
    const candles4h = await fetchOHLCV(symbol, "4h");

    if (!isCompression(candles4h)) {
      return { result: null, stage: "compression" };
    }

    const breakout = isBreakout(candles4h);
    if (!breakout.ok) {
      return { result: null, stage: "breakout" };
    }

    const candles15m = await fetchOHLCV(symbol, "15m");
    if (!isValidRetest(candles15m, breakout.resistance)) {
      return { result: null, stage: "retest" };
    }

    // 計算盤整區間最低點（用於止損計算）
    const recent4h = candles4h.slice(-CONFIG.COMPRESSION_CANDLE_COUNT);
    let compressionLow = recent4h[0].low;
    for (let i = 1; i < recent4h.length; i++) {
      if (recent4h[i].low < compressionLow) {
        compressionLow = recent4h[i].low;
      }
    }

    // 入場價：使用15m K線的最後收盤價（回踩確認後的價格）
    const entryPrice = candles15m[candles15m.length - 1].close;

    // 計算止盈止損
    const sltp = calculateStopLossAndTakeProfit(
      entryPrice,
      breakout.resistance,
      compressionLow,
      candles4h,
    );

    const result: {
      symbol: string;
      entryPrice: string;
      stopLoss: string;
      takeProfit: string;
    } = {
      symbol,
      entryPrice: entryPrice.toFixed(4),
      stopLoss: sltp.stopLoss.toFixed(4),
      takeProfit: sltp.takeProfit.toFixed(4),
    };

    return {
      result,
      stage: "success",
    };
  } catch (err) {
    return { result: null, stage: "error" };
  }
}

async function main() {
  const symbols = await getAllTradableSymbols();

  const results = [];
  const stats = {
    compression: 0,
    breakout: 0,
    retest: 0,
    error: 0,
    success: 0,
  };

  const startedAtMs = Date.now();
  let done = 0;

  updateProgressLine({ done, total: symbols.length, startedAtMs });

  // 使用定時器定期更新進度（避免競爭條件，減少 I/O 開銷）
  const progressInterval = setInterval(() => {
    updateProgressLine({
      done,
      total: symbols.length,
      startedAtMs,
    });
  }, CONFIG.PROGRESS_UPDATE_INTERVAL_MS);

  // 使用並行處理加速掃描
  const scanResults = await pMap(
    symbols,
    async (symbol) => {
      const scanResult = await scanSymbol(symbol);
      done += 1;
      return scanResult;
    },
    CONFIG.CONCURRENCY_LIMIT,
  );

  // 停止定時器並最終更新一次進度
  clearInterval(progressInterval);
  updateProgressLine({
    done: symbols.length,
    total: symbols.length,
    startedAtMs,
  });

  // 收集結果和統計
  for (const scanResult of scanResults) {
    stats[scanResult.stage] += 1;
    if (scanResult.result) {
      results.push(scanResult.result);
    }
  }

  if (process.stdout.isTTY) process.stdout.write("\n");

  if (results.length === 0) {
    console.log(`\n掃描完成: ${symbols.length} 個標的，未找到符合條件的突破機會`);
  } else {
    console.log(`\n找到 ${results.length} 個符合條件的突破機會:\n`);
    console.table(results);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
