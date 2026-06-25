import { kvSet, kvGet } from "../../lib/kv";

export async function POST(request) {
  try {
    const body = await request.json();
    const { verdict, confidence, reasoning, timestamp } = body;

    if (!verdict || !["bullish", "bearish", "uncertain"].includes(verdict)) {
      return Response.json({ error: "Invalid verdict value" }, { status: 400 });
    }

    const stored = { verdict, confidence, reasoning, timestamp, storedAt: new Date().toISOString() };
    await kvSet("nikkei:verdict:latest", stored);

    return Response.json({ ok: true, stored });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

export async function GET() {
  try {
    const stored = await kvGet("nikkei:verdict:latest");
    if (!stored) return Response.json({ verdict: null });
    return Response.json(stored);
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
