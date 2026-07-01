import { kvGet } from "../../lib/kv";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const trades = await kvGet("nikkei:trade:log");
    return Response.json({ trades: trades || [] });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
