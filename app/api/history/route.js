import { getIGSession, parseIGTime, toBSTLabel, NIKKEI_EPIC } from "../../lib/ig-auth";
import { kvGet } from "../../lib/kv";

const STAKE = 2;         // £2 per point
const STOP_PTS = 200;   // stop loss distance
const LIMIT_PTS = 500;  // take profit distance

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Rolling EMA over a chronological price series — returns an array the same
// length as `closes`, with a value at index i only once `period` prior
// closes are available (matches the live trade route's calculateEMA, but
// keeps every intermediate value instead of just the final one).
function computeRollingEMA(closes, period) {
  const result = new Array(closes.length).fill(null);
  if (closes.length < period) return result;
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result[period - 1] = ema;
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
    result[i] = ema;
  }
  return result;
}

// Mirrors the exact 3-way confirmation /api/trade requires before placing a
// real order (stored verdict + 1am->1:30am candle direction + price vs
// EMA20) so this backtest reports on the strategy actually being traded,
// not a looser "always follow the verdict" simulation.
function backtestFromVerdict(verdict, candles) {
  if (!verdict || verdict === "uncertain") {
    return { signal: "none", pnl: 0, exit: null, entry: null };
  }

  const oneAmCandle = candles.find(c => c.utcHour === 0 && c.utcMin === 0);
  const oneThirtyCandle = candles.find(c => c.utcHour === 0 && c.utcMin === 30);

  if (!oneAmCandle || !oneThirtyCandle) {
    return { signal: "none", pnl: 0, exit: null, entry: null };
  }

  const candleMove = oneThirtyCandle.close - oneAmCandle.close;
  const candleDirection = candleMove > 30 ? "bullish" : candleMove < -30 ? "bearish" : "flat";
  const priceVsEMA = oneThirtyCandle.ema20 != null
    ? (oneThirtyCandle.close > oneThirtyCandle.ema20 ? "above" : "below")
    : null;

  const bullishSignal = verdict === "bullish" && candleDirection === "bullish" && priceVsEMA === "above";
  const bearishSignal = verdict === "bearish" && candleDirection === "bearish" && priceVsEMA === "below";

  if (!bullishSignal && !bearishSignal) {
    return { signal: "none", pnl: 0, exit: null, entry: null };
  }

  const signal = bullishSignal ? "BUY" : "SELL";
  const entry = oneThirtyCandle.close;
  const stopLevel  = signal === "BUY" ? entry - STOP_PTS  : entry + STOP_PTS;
  const limitLevel = signal === "BUY" ? entry + LIMIT_PTS : entry - LIMIT_PTS;

  // Scan candles after 1:30am using HIGH and LOW for accurate hit detection
  const oneThirtyIdx = candles.indexOf(oneThirtyCandle);
  const afterCandles = oneThirtyIdx >= 0 ? candles.slice(oneThirtyIdx + 1) : [];

  for (const c of afterCandles) {
    if (signal === "BUY") {
      if (c.low  !== null && c.low  <= stopLevel)  return { signal, pnl: -(STOP_PTS * STAKE),  exit: "stop",  entry };
      if (c.high !== null && c.high >= limitLevel) return { signal, pnl:  (LIMIT_PTS * STAKE), exit: "limit", entry };
    } else {
      if (c.high !== null && c.high >= stopLevel)  return { signal, pnl: -(STOP_PTS * STAKE),  exit: "stop",  entry };
      if (c.low  !== null && c.low  <= limitLevel) return { signal, pnl:  (LIMIT_PTS * STAKE), exit: "limit", entry };
    }
  }

  return { signal, pnl: 0, exit: "open", entry };
}

export async function GET() {
  try {
    const { cst, token, baseUrl, apiKey } = await getIGSession();

    const res = await fetch(`${baseUrl}/prices/${NIKKEI_EPIC}/MINUTE_30/500`, {
      cache: "no-store",
      headers: {
        "X-IG-API-KEY": apiKey,
        "CST": cst,
        "X-SECURITY-TOKEN": token,
        "Accept": "application/json; charset=UTF-8",
        "Version": "1",
      },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`IG prices failed (${res.status}): ${body.slice(0, 200)}`);
    }

    const data = await res.json();
    const prices = data.prices || [];

    if (prices.length === 0) {
      return Response.json({ error: "No price data returned from IG" }, { status: 502 });
    }

    // Parse into a flat, chronologically-sorted series first so EMA20 can be
    // computed continuously (like a real indicator would be), rather than
    // resetting at each session boundary.
    const flat = prices
      .map(p => {
        try {
          const closeBid = p?.closePrice?.bid;
          const closeAsk = p?.closePrice?.ask;
          if (closeBid == null || closeAsk == null) return null;

          const d = parseIGTime(p.snapshotTime);
          if (!d) return null;

          return {
            date: d,
            utcHour: d.getUTCHours(),
            utcMin: d.getUTCMinutes(),
            close: (closeBid + closeAsk) / 2,
            high: p.highPrice ? (p.highPrice.bid + p.highPrice.ask) / 2 : null,
            low: p.lowPrice ? (p.lowPrice.bid + p.lowPrice.ask) / 2 : null,
            label: toBSTLabel(d),
          };
        } catch (_) {
          return null;
        }
      })
      .filter(c => c !== null)
      .sort((a, b) => a.date - b.date);

    const emaSeries = computeRollingEMA(flat.map(c => c.close), 20);
    flat.forEach((c, i) => { c.ema20 = emaSeries[i]; });

    // Group candles by BST session date
    const bySession = {};

    flat.forEach(c => {
      const { utcHour } = c;
      let sessionDate;
      if (utcHour === 23) {
        const next = new Date(c.date.getTime() + 86400000);
        sessionDate = next.toISOString().slice(0, 10);
      } else if (utcHour < 7) {
        sessionDate = c.date.toISOString().slice(0, 10);
      } else {
        return;
      }

      if (!bySession[sessionDate]) bySession[sessionDate] = [];
      bySession[sessionDate].push(c);
    });

    // Fetch stored analyses from Redis
    const sessionIndex = await kvGet("nikkei:sessions:index") || [];
    const analyses = {};
    await Promise.all(
      sessionIndex.map(async date => {
        try {
          const analysis = await kvGet(`nikkei:session:${date}`);
          if (analysis) analyses[date] = analysis;
        } catch (_) {}
      })
    );

    // Build sessions with backtest
    const sessions = Object.entries(bySession)
      .map(([date, candles]) => {
        candles.sort((a, b) => {
          const aVal = a.utcHour === 23 ? -1 : a.utcHour * 60 + a.utcMin;
          const bVal = b.utcHour === 23 ? -1 : b.utcHour * 60 + b.utcMin;
          return aVal - bVal;
        });

        const openCandle  = candles.find(c => c.utcHour === 23 && c.utcMin === 0)
                         || candles.find(c => c.utcHour === 0  && c.utcMin === 0);
        const closeCandle = [...candles].reverse().find(c => c.utcHour < 7);

        let actualDirection = "uncertain";
        let pointsMoved = null;
        if (openCandle?.close && closeCandle?.close) {
          const move = closeCandle.close - openCandle.close;
          pointsMoved = Math.round(move);
          if (move > 100) actualDirection = "bullish";
          else if (move < -100) actualDirection = "bearish";
        }

        // Only run backtest if we have a stored verdict for this session
        const analysis = analyses[date] || null;
        const backtest = analysis
          ? backtestFromVerdict(analysis.verdict, candles)
          : { signal: "none", pnl: 0, exit: null, entry: null };

        return {
          date,
          actualDirection,
          pointsMoved,
          openPrice: openCandle ? Math.round(openCandle.close) : null,
          candles: candles.map(c => ({ time: c.label, price: c.close })),
          analysis,
          backtest,
        };
      })
      .filter(s => s.openPrice !== null && s.candles.length > 3)
      .reverse();

    // P&L summary — only sessions with real stored verdicts
    const withVerdicts = sessions.filter(s => s.analysis && s.backtest.signal !== "none");
    const wins     = withVerdicts.filter(s => s.backtest.exit === "limit");
    const losses   = withVerdicts.filter(s => s.backtest.exit === "stop");
    const openEnd  = withVerdicts.filter(s => s.backtest.exit === "open");
    // "Skipped" = had a stored analysis but no trade was taken — either the
    // verdict was uncertain, or the candle/EMA confirmation didn't align
    // (same reasons the live /api/trade route would have skipped it too).
    const skipped  = sessions.filter(s => s.analysis && s.backtest.signal === "none");
    const totalPnl = withVerdicts.reduce((sum, s) => sum + s.backtest.pnl, 0);

    const summary = {
      totalSessions: sessions.length,
      withVerdicts: withVerdicts.length,
      wins: wins.length,
      losses: losses.length,
      openEnd: openEnd.length,
      skipped: skipped.length,
      noVerdict: sessions.length - (withVerdicts.length + skipped.length),
      totalPnl,
      winRate: withVerdicts.length > 0 ? Math.round((wins.length / withVerdicts.length) * 100) : null,
      avgWin:  wins.length   > 0 ? Math.round(wins.reduce((s, t)   => s + t.backtest.pnl, 0) / wins.length)   : null,
      avgLoss: losses.length > 0 ? Math.round(losses.reduce((s, t) => s + t.backtest.pnl, 0) / losses.length) : null,
    };

    return Response.json({ sessions, summary });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
