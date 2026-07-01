import { getIGSession, parseIGTime, toBSTLabel, NIKKEI_EPIC } from "../../lib/ig-auth";
import { kvGet } from "../../lib/kv";

const STAKE = 2;         // £2 per point
const STOP_PTS = 200;   // stop loss distance
const LIMIT_PTS = 500;  // take profit distance

export const dynamic = "force-dynamic";
export const revalidate = 0;

function backtestFromVerdict(verdict, candles) {
  // Only backtest if we have a real stored verdict
  if (!verdict || verdict === "uncertain") {
    return { signal: "none", pnl: 0, exit: null, entry: null };
  }

  const signal = verdict === "bullish" ? "BUY" : "SELL";

  // Find 1:30am BST candle (00:30 UTC) as entry — closest match
  function sortVal(c) {
    return c.utcHour === 23 ? -1 : c.utcHour * 60 + c.utcMin;
  }

  const oneThirtyCandle = candles.reduce((best, c) => {
    if (c.utcHour === 23) return best;
    const diff = Math.abs(sortVal(c) - 30); // 30 = 00:30 UTC
    const bestDiff = best ? Math.abs(sortVal(best) - 30) : Infinity;
    return diff < bestDiff ? c : best;
  }, null);

  if (!oneThirtyCandle) {
    return { signal: "none", pnl: 0, exit: null, entry: null };
  }

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

    // Group candles by BST session date, storing close + high + low
    const bySession = {};

    prices.forEach(p => {
      try {
        const closeBid = p?.closePrice?.bid;
        const closeAsk = p?.closePrice?.ask;
        if (closeBid == null || closeAsk == null) return;

        const d = parseIGTime(p.snapshotTime);
        if (!d) return;

        const utcHour = d.getUTCHours();
        const utcMin  = d.getUTCMinutes();

        let sessionDate;
        if (utcHour === 23) {
          const next = new Date(d.getTime() + 86400000);
          sessionDate = next.toISOString().slice(0, 10);
        } else if (utcHour < 7) {
          sessionDate = d.toISOString().slice(0, 10);
        } else {
          return;
        }

        if (!bySession[sessionDate]) bySession[sessionDate] = [];
        bySession[sessionDate].push({
          utcHour,
          utcMin,
          close: (closeBid + closeAsk) / 2,
          high:  p.highPrice  ? (p.highPrice.bid  + p.highPrice.ask)  / 2 : null,
          low:   p.lowPrice   ? (p.lowPrice.bid   + p.lowPrice.ask)   / 2 : null,
          label: toBSTLabel(d),
        });
      } catch (_) {}
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
    const skipped  = sessions.filter(s => s.analysis && s.analysis.verdict === "uncertain");
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
