import { getIGSession, parseIGTime, toBSTLabel, NIKKEI_EPIC } from "../../lib/ig-auth";

export async function GET() {
  try {
    const { cst, token, baseUrl, apiKey } = await getIGSession();

    const res = await fetch(`${baseUrl}/prices/${NIKKEI_EPIC}/MINUTE_30/20`, {
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
      const points = prices
  .map(p => {
    const mid = (p.closePrice.bid + p.closePrice.ask) / 2;
    const d = parseIGTime(p.snapshotTime);
    if (!d) return null;
    return { time: toBSTLabel(d), price: Math.round(mid * 10) / 10 };
  })
  .filter(p => p && p.price);

    return Response.json({ points });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
