import { getIGSession, parseIGTime, toBSTLabel, NIKKEI_EPIC } from "../../lib/ig-auth";

export async function GET() {
  try {
    const { cst, token, baseUrl, apiKey } = await getIGSession();

    // Build date range: midnight BST (23:00 UTC previous day) to 6am BST (05:00 UTC)
    // The Tokyo session spans two UTC calendar days:
    //   23:00 UTC (day N) → 05:00 UTC (day N+1)
    // So UTC hours 00:00-05:00 mean we're INSIDE tonight's session (start was 23:00 yesterday UTC)
    // UTC hours 05:00-23:00 mean the session is over — show the most recently completed one

    const now = new Date();
    const utcHour = now.getUTCHours();

    const sessionStart = new Date(now);
    sessionStart.setUTCMinutes(0, 0, 0);

    if (utcHour >= 5 && utcHour < 23) {
      // Session is over for today — show the most recently completed session
      // Start was 23:00 UTC yesterday
      sessionStart.setUTCDate(sessionStart.getUTCDate() - 1);
      sessionStart.setUTCHours(23, 0, 0, 0);
    } else if (utcHour < 5) {
      // We're inside tonight's session — start was 23:00 UTC yesterday
      sessionStart.setUTCDate(sessionStart.getUTCDate() - 1);
      sessionStart.setUTCHours(23, 0, 0, 0);
    } else {
      // utcHour === 23 — session is just starting now
      sessionStart.setUTCHours(23, 0, 0, 0);
    }

    // Session end: 05:00 UTC (6am BST)
    const sessionEnd = new Date(sessionStart);
    sessionEnd.setUTCDate(sessionEnd.getUTCDate() + 1);
    sessionEnd.setUTCHours(5, 0, 0, 0);

    // Format dates for IG API: "yyyy:MM:dd-HH:mm:ss"
    const fmt = (d) => {
      const y = d.getUTCFullYear();
      const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
      const dd = String(d.getUTCDate()).padStart(2, "0");
      const h = String(d.getUTCHours()).padStart(2, "0");
      const mi = String(d.getUTCMinutes()).padStart(2, "0");
      const s = String(d.getUTCSeconds()).padStart(2, "0");
      return `${y}:${mo}:${dd}-${h}:${mi}:${s}`;
    };

    const url = `${baseUrl}/prices/${NIKKEI_EPIC}/MINUTE_30?startdate=${encodeURIComponent(fmt(sessionStart))}&enddate=${encodeURIComponent(fmt(sessionEnd))}`;

    const res = await fetch(url, {
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
      return Response.json({ error: "No price data for this session window yet — market may not have opened" }, { status: 502 });
    }

    const points = prices
      .map(p => {
        try {
          const bid = p?.closePrice?.bid;
          const ask = p?.closePrice?.ask;
          if (bid == null || ask == null) return null;
          const mid = (bid + ask) / 2;
          const d = parseIGTime(p.snapshotTime);
          if (!d) return null;
          return { time: toBSTLabel(d), price: Math.round(mid * 10) / 10 };
        } catch (_) {
          return null;
        }
      })
      .filter(p => p !== null);

    if (points.length === 0) {
      return Response.json({ error: "All price candles failed to parse" }, { status: 502 });
    }

    return Response.json({ points });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
