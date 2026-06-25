import { getIGSession, parseIGTime, toBSTLabel, NIKKEI_EPIC } from "../../lib/ig-auth";

export async function GET() {
  try {
    const { cst, token, baseUrl, apiKey } = await getIGSession();

    // 500 candles at 30-min covers ~25 trading days (each session ~13 candles)
    const res = await fetch(`${baseUrl}/prices/${NIKKEI_EPIC}/MINUTE_30/500`, {
      headers: {
        "X-IG-API-KEY": apiKey,
        "CST": cst,
        "X-SECURITY-TOKEN": token,
        "Accept": "application/json; charset=UTF-8",
        "Version": "2",
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

    // Group candles by BST session date
    // Session starts at 23:00 UTC (midnight BST) and runs to ~06:30 UTC
    const bySession = {};

   prices.forEach(p => {
  const mid = (p.closePrice.bid + p.closePrice.ask) / 2;
  if (!mid) return;
  const d = parseIGTime(p.snapshotTime);
  if (!d) return;
      const utcHour = d.getUTCHours();
      const utcMin = d.getUTCMinutes();

      let sessionDate;
      if (utcHour === 23) {
        // Midnight BST — label as next UTC day (the actual BST session date)
        const next = new Date(d.getTime() + 86400000);
        sessionDate = next.toISOString().slice(0, 10);
      } else if (utcHour < 7) {
        sessionDate = d.toISOString().slice(0, 10);
      } else {
        return; // Outside Tokyo session hours
      }

      if (!bySession[sessionDate]) bySession[sessionDate] = [];
      bySession[sessionDate].push({
        utcHour,
        utcMin,
        close: mid,
        label: toBSTLabel(d),
      });
    });

    const sessions = Object.entries(bySession)
      .map(([date, candles]) => {
        // Sort chronologically: 23:00 UTC first, then 00:00 onwards
        candles.sort((a, b) => {
          const aVal = a.utcHour === 23 ? -1 : a.utcHour * 60 + a.utcMin;
          const bVal = b.utcHour === 23 ? -1 : b.utcHour * 60 + b.utcMin;
          return aVal - bVal;
        });

        // Open = midnight BST (23:00 UTC) or failing that 1am BST (00:00 UTC)
        const openCandle = candles.find(c => c.utcHour === 23 && c.utcMin === 0)
          || candles.find(c => c.utcHour === 0 && c.utcMin === 0);

        // Close = last candle of the session
        const closeCandle = [...candles].reverse().find(c => c.utcHour < 7);

        let direction = "uncertain";
        let pointsMoved = null;

        if (openCandle?.close && closeCandle?.close) {
          const move = closeCandle.close - openCandle.close;
          pointsMoved = Math.round(move);
          if (move > 100) direction = "bullish";
          else if (move < -100) direction = "bearish";
        }

        return {
          date,
          direction,
          pointsMoved,
          openPrice: openCandle ? Math.round(openCandle.close) : null,
          candles: candles.map(c => ({ time: c.label, price: c.close })),
        };
      })
      .filter(s => s.openPrice !== null && s.candles.length > 3)
      .reverse(); // Most recent first

    return Response.json({ sessions });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
