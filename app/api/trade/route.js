import { kvSet, kvGet } from "../../lib/kv";
import { getIGSession, parseIGTime, NIKKEI_EPIC } from "../../lib/ig-auth";

const STOP_DISTANCE = 200;
const LIMIT_DISTANCE = 500;
const STAKE = 2; // £2 per point
const ACCOUNT_ID = "Z67JKW"; // Spread bet demo account

// Calculate EMA for a series of prices
function calculateEMA(prices, period) {
  if (prices.length < period) return null;
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
}

export async function GET(request) {
  const isManual = request.headers.get("x-manual-trigger") === "true";
  const log = [];

  try {
    // 1. Get stored verdict from evening Analyse run
    const raw = await kvGet("nikkei:verdict:latest");
    if (!raw) {
      return Response.json({ skipped: true, reason: "No verdict stored — run Analyse first this evening" });
    }

    const stored = typeof raw === "string" ? JSON.parse(raw) : raw;
    const { verdict, confidence, timestamp: verdictTime } = stored;

    log.push(`Verdict: ${verdict} (${confidence}) stored at ${verdictTime}`);

    // Skip if verdict is uncertain
    if (verdict === "uncertain") {
      return Response.json({ skipped: true, reason: "Verdict is uncertain — no trade placed", log });
    }

    // Check verdict is from today (within last 18 hours)
    const verdictAge = Date.now() - new Date(verdictTime).getTime();
    if (verdictAge > 18 * 60 * 60 * 1000) {
      return Response.json({ skipped: true, reason: "Verdict is too old — run Analyse again this evening", log });
    }

    // 2. Fetch recent candles from IG to check 1am candle direction and EMA
    const { cst, token, baseUrl, apiKey } = await getIGSession();

    const priceRes = await fetch(`${baseUrl}/prices/${NIKKEI_EPIC}/MINUTE_30/30`, {
      headers: {
        "X-IG-API-KEY": apiKey,
        "CST": cst,
        "X-SECURITY-TOKEN": token,
        "Accept": "application/json; charset=UTF-8",
        "Version": "1",
      },
    });

    if (!priceRes.ok) {
      const body = await priceRes.text();
      throw new Error(`IG prices failed (${priceRes.status}): ${body.slice(0, 200)}`);
    }

    const priceData = await priceRes.json();
    const prices = priceData.prices || [];

    if (prices.length < 3) {
      return Response.json({ skipped: true, reason: "Insufficient price data returned from IG", log });
    }

    // Parse candles into mid prices with timestamps
    const candles = prices
      .map(p => {
        try {
          const bid = p?.closePrice?.bid;
          const ask = p?.closePrice?.ask;
          if (bid == null || ask == null) return null;
          const d = parseIGTime(p.snapshotTime);
          if (!d) return null;
          return { time: d, price: (bid + ask) / 2 };
        } catch (_) { return null; }
      })
      .filter(c => c !== null);

    if (candles.length < 3) {
      return Response.json({ skipped: true, reason: "Not enough valid candles to assess signal", log });
    }

    // Find the 1am BST candle (00:00 UTC)
    const oneAmCandle = candles.find(c => c.time.getUTCHours() === 0 && c.time.getUTCMinutes() === 0);
    // Find the 1:30am BST candle (00:30 UTC) — the most recent closed candle at trigger time
    const oneThirtyCandle = candles.find(c => c.time.getUTCHours() === 0 && c.time.getUTCMinutes() === 30);

    if (!oneAmCandle || !oneThirtyCandle) {
      return Response.json({ skipped: true, reason: `Required candles not found — 1am: ${!!oneAmCandle}, 1:30am: ${!!oneThirtyCandle}`, log });
    }

    // 3. Check 1am candle direction
    const candleMove = oneThirtyCandle.price - oneAmCandle.price;
    const candleDirection = candleMove > 30 ? "bullish" : candleMove < -30 ? "bearish" : "flat";
    log.push(`1am→1:30am candle move: ${Math.round(candleMove)} pts (${candleDirection})`);

    // 4. Calculate EMA20 from available closes
    const closes = candles.map(c => c.price);
    const ema20 = calculateEMA(closes, 20);
    const currentPrice = oneThirtyCandle.price;
    const priceVsEMA = ema20 ? (currentPrice > ema20 ? "above" : "below") : null;
    log.push(`EMA20: ${ema20 ? Math.round(ema20) : "insufficient data"}, price ${priceVsEMA || "unknown"} EMA`);

    // 5. Check all conditions align
    const verdictBullish = verdict === "bullish";
    const verdictBearish = verdict === "bearish";
    const candleBullish = candleDirection === "bullish";
    const candleBearish = candleDirection === "bearish";
    const emaConfirmsBullish = priceVsEMA === "above";
    const emaConfirmsBearish = priceVsEMA === "below";

    const bullishSignal = verdictBullish && candleBullish && emaConfirmsBullish;
    const bearishSignal = verdictBearish && candleBearish && emaConfirmsBearish;

    if (!bullishSignal && !bearishSignal) {
      const reasons = [];
      if (verdictBullish && !candleBullish) reasons.push(`candle is ${candleDirection} not bullish`);
      if (verdictBearish && !candleBearish) reasons.push(`candle is ${candleDirection} not bearish`);
      if (verdictBullish && !emaConfirmsBullish) reasons.push(`price is ${priceVsEMA} EMA (needs above for bullish)`);
      if (verdictBearish && !emaConfirmsBearish) reasons.push(`price is ${priceVsEMA} EMA (needs below for bearish)`);
      return Response.json({ skipped: true, reason: `Conditions not aligned: ${reasons.join(", ")}`, log });
    }

    const direction = bullishSignal ? "BUY" : "SELL";
    log.push(`All conditions met — placing ${direction} trade`);

    // 6. Place the trade
    const tradeRes = await fetch(`${baseUrl}/positions/otc`, {
      method: "POST",
      headers: {
        "X-IG-API-KEY": apiKey,
        "CST": cst,
        "X-SECURITY-TOKEN": token,
        "IG-ACCOUNT-ID": ACCOUNT_ID,
        "Content-Type": "application/json; charset=UTF-8",
        "Accept": "application/json; charset=UTF-8",
        "Version": "2",
      },
      body: JSON.stringify({
        epic: NIKKEI_EPIC,
        expiry: "DFB",
        direction,
        size: STAKE,
        orderType: "MARKET",
        timeInForce: "FILL_OR_KILL",
        guaranteedStop: false,
        stopDistance: STOP_DISTANCE,
        limitDistance: LIMIT_DISTANCE,
        forceOpen: true,
        currencyCode: "GBP",
      }),
    });

    const tradeBody = await tradeRes.json();
    const dealRef = tradeBody.dealReference;

    if (!dealRef) {
      throw new Error(`Trade placement failed: ${JSON.stringify(tradeBody).slice(0, 200)}`);
    }

    log.push(`Deal reference: ${dealRef}`);

    // 7. Confirm the trade
    await new Promise(r => setTimeout(r, 1500)); // Wait 1.5s for IG to process
    const confirmRes = await fetch(`${baseUrl}/confirms/${dealRef}`, {
      headers: {
        "X-IG-API-KEY": apiKey,
        "CST": cst,
        "X-SECURITY-TOKEN": token,
        "IG-ACCOUNT-ID": ACCOUNT_ID,
        "Accept": "application/json; charset=UTF-8",
        "Version": "1",
      },
    });

    const confirm = await confirmRes.json();
    log.push(`Deal status: ${confirm.dealStatus}, level: ${confirm.level}, stop: ${confirm.stopLevel}, limit: ${confirm.limitLevel}`);

    // 8. Store trade in log
    const tradeRecord = {
      timestamp: new Date().toISOString(),
      direction,
      verdict,
      confidence,
      candleMove: Math.round(candleMove),
      ema20: ema20 ? Math.round(ema20) : null,
      dealReference: dealRef,
      dealId: confirm.dealId,
      status: confirm.dealStatus,
      entryLevel: confirm.level,
      stopLevel: confirm.stopLevel,
      limitLevel: confirm.limitLevel,
      isManual,
    };

    const existingRaw = await kvGet("nikkei:trade:log");
    const existing = existingRaw ? (typeof existingRaw === "string" ? JSON.parse(existingRaw) : existingRaw) : [];
    await kvSet("nikkei:trade:log", JSON.stringify([tradeRecord, ...existing].slice(0, 60)));

    return Response.json({ traded: true, direction, dealReference: dealRef, confirm, log });
  } catch (err) {
    return Response.json({ error: err.message, log }, { status: 500 });
  }
}
