import { getIGSession, parseIGTime, toBSTLabel } from "../../lib/ig-auth";

const EPIC = "IX.D.NIKKEI.CASH.IP";

export async function GET() {
  try {
    const { cst, token, baseUrl, apiKey } = await getIGSession();

    // Fetch last 20 candles at 30-min = covers ~10 hours (current + previous session)
    const res = await fetch(`${baseUrl}/prices/${EPIC}/MINUTE_30/20`, {
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

    const points = prices
      .map(p => {
        const mid = (p.closePrice.bid + p.closePrice.ask) / 2;
        const d = parseIGTime(p.snapshotTime);
        return { time: toBSTLabel(d), price: Math.round(mid * 10) / 10 };
      })
      .filter(p => p.price);

    return Response.json({ points });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
