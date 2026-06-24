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

    // Each Tokyo session starts at 23:00 UTC the previous evening (= midnight BST in summer)
    // and runs through to ~06:30 UTC (= 7:30am BST).
    // We group candles by the BST calendar date of the session open (midnight BST),
    // which means candles from 23:00 UTC on day N belong to the session labelled day N+1.
    const bySession = {};
    timestamps.forEach((t, i) => {
      if (closes[i] === null || closes[i] === undefined) return;
      const d = new Date(t * 1000);
      const utcHour = d.getUTCHours();
      const utcMin = d.getUTCMinutes();

      // Session label = the BST date of the Tokyo open (midnight BST)
      // Candles from 23:00 UTC belong to the NEXT calendar day in BST
      let sessionDate;
      if (utcHour === 23) {
        // This candle is midnight BST — label it as next UTC day
        const next = new Date(t * 1000 + 86400000);
        sessionDate = next.toISOString().slice(0, 10);
      } else if (utcHour < 7) {
        // Morning session candles — same UTC date as the BST session date
        sessionDate = d.toISOString().slice(0, 10);
      } else {
        // Outside Tokyo hours — skip
        return;
      }

      if (!bySession[sessionDate]) bySession[sessionDate] = [];
      bySession[sessionDate].push({
        utcHour,
        utcMin,
        close: closes[i],
        label: d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" }),
      });
    });

    // Build one session object per day
    const sessions = Object.entries(bySession)
      .map(([date, candles]) => {
        // Sort candles chronologically (23:00 first, then 00:00 onwards)
        candles.sort((a, b) => {
          const aVal = a.utcHour === 23 ? -1 : a.utcHour * 60 + a.utcMin;
          const bVal = b.utcHour === 23 ? -1 : b.utcHour * 60 + b.utcMin;
          return aVal - bVal;
        });

        // Midnight BST open = 23:00 UTC candle
        const openCandle = candles.find(c => c.utcHour === 23 && c.utcMin === 0);
        // 1am BST = 00:00 UTC — the Tokyo official open
        const tokyoOpen = candles.find(c => c.utcHour === 0 && c.utcMin === 0);
        // Measure direction from midnight open to session close (~06:30 UTC)
        const closeCandle = [...candles].reverse().find(c => c.utcHour < 7);

        let direction = "uncertain";
        let pointsMoved = null;
        const refCandle = openCandle || tokyoOpen;

        if (refCandle?.close && closeCandle?.close) {
          const move = closeCandle.close - refCandle.close;
          pointsMoved = Math.round(move);
          if (move > 100) direction = "bullish";
          else if (move < -100) direction = "bearish";
        }

        return {
          date,
          direction,
          pointsMoved,
          openPrice: refCandle ? Math.round(refCandle.close) : null,
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
