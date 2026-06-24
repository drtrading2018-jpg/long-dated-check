export async function GET() {
  try {
    const url = "https://query1.finance.yahoo.com/v8/finance/chart/%5EN225?range=1mo&interval=30m";
    const res = await fetch(url, {
      headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0" },
    });
    const data = await res.json();

    const result = data?.chart?.result?.[0];
    if (!result) {
      return Response.json({ error: "No data returned for ^N225" }, { status: 502 });
    }

    const timestamps = result.timestamp || [];
    const closes = result.indicators?.quote?.[0]?.close || [];

    // Group candles by UTC date
    const byDate = {};
    timestamps.forEach((t, i) => {
      if (closes[i] === null || closes[i] === undefined) return;
      const d = new Date(t * 1000);
      const dateKey = d.toISOString().slice(0, 10);
      if (!byDate[dateKey]) byDate[dateKey] = [];
      byDate[dateKey].push({
        utcHour: d.getUTCHours(),
        utcMin: d.getUTCMinutes(),
        close: closes[i],
        label: d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" }),
      });
    });

    // Build one session object per day
    const sessions = Object.entries(byDate)
      .map(([date, candles]) => {
        // 1am BST = 00:00 UTC (summer) — the Tokyo open candle
        const openCandle = candles.find(c => c.utcHour === 0 && c.utcMin === 0);
        // 2 hours later = 02:00 UTC (3am BST) — enough time to see the move
        const laterCandle = candles.find(c => c.utcHour === 2 && c.utcMin === 0);

        let direction = "uncertain";
        let pointsMoved = null;

        if (openCandle?.close && laterCandle?.close) {
          const move = laterCandle.close - openCandle.close;
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
      .filter(s => s.openPrice !== null)
      .reverse(); // Most recent first

    return Response.json({ sessions });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
