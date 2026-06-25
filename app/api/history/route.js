import { getIGSession, parseIGTime, toBSTLabel, NIKKEI_EPIC } from "../../lib/ig-auth";
import { kvGet } from "../../lib/kv";

export async function GET() {
  try {
    const { cst, token, baseUrl, apiKey } = await getIGSession();

    // Fetch 1,000 candles = ~3.5 months of overnight sessions
    const res = await fetch(`${baseUrl}/prices/${NIKKEI_EPIC}/MINUTE_30/1000`, {
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

    // Group candles by BST session date (midnight BST = 23:00 UTC previous day)
    const bySession = {};

    prices.forEach(p => {
      try {
        const bid = p?.closePrice?.bid;
        const ask = p?.closePrice?.ask;
        if (bid == null || ask == null) return;
        const mid = (bid + ask) / 2;
        if (!mid) return;

        const d = parseIGTime(p.snapshotTime);
        if (!d) return;

        const utcHour = d.getUTCHours();
        const utcMin = d.getUTCMinutes();

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
          utcHour, utcMin,
          close: mid,
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

    // Build sessions
    const sessions = Object.entries(bySession)
      .map(([date, candles]) => {
        candles.sort((a, b) => {
          const aVal = a.utcHour === 23 ? -1 : a.utcHour * 60 + a.utcMin;
          const bVal = b.utcHour === 23 ? -1 : b.utcHour * 60 + b.utcMin;
          return aVal - bVal;
        });

        const openCandle = candles.find(c => c.utcHour === 23 && c.utcMin === 0)
          || candles.find(c => c.utcHour === 0 && c.utcMin === 0);
        const closeCandle = [...candles].reverse().find(c => c.utcHour < 7);

        let actualDirection = "uncertain";
        let pointsMoved = null;

        if (openCandle?.close && closeCandle?.close) {
          const move = closeCandle.close - openCandle.close;
          pointsMoved = Math.round(move);
          if (move > 100) actualDirection = "bullish";
          else if (move < -100) actualDirection = "bearish";
        }

        return {
          date,
          actualDirection,
          pointsMoved,
          openPrice: openCandle ? Math.round(openCandle.close) : null,
          candles: candles.map(c => ({ time: c.label, price: c.close })),
          analysis: analyses[date] || null, // Full stored analysis if available
        };
      })
      .filter(s => s.openPrice !== null && s.candles.length > 3)
      .reverse();

    return Response.json({ sessions });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
