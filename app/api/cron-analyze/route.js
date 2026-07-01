import { kvSet, kvGet } from "../../lib/kv";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Runs at 1am BST (00:00 UTC) via Vercel cron
// Stores full analysis in Redis keyed by session date
// Also updates nikkei:verdict:latest for the 1:30am trade cron

export async function GET() {
  const sessionDate = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC date at 1am BST

  // Already ran today — return the stored result instead of re-billing Anthropic
  try {
    const existing = await kvGet(`nikkei:session:${sessionDate}`);
    if (existing) {
      return Response.json({ ok: true, sessionDate, verdict: existing.verdict, confidence: existing.confidence, cached: true });
    }
  } catch (_) {
    // KV unavailable — fall through and run a fresh analysis rather than blocking
  }

  const systemPrompt = `You are a financial market analyst specialising in the Japan 225 (Nikkei) index. The user monitors the Nikkei 225 around the Tokyo open (1am UK BST / 9am JST) for a 500+ point directional move.
Their research shows the single biggest cause of unexpected moves is scheduled macro events (BOJ, Fed, major data) or breaking news (IPOs, geopolitical events) — not USD/JPY correlation, which they've ruled out as unreliable.
Focus entirely on identifying anything that could override the normal technical pattern tonight.

Run at most 3 searches total — one per topic below. Do not run follow-up or exploratory searches beyond those 3 unless a search genuinely fails.

After you finish searching, your FINAL message must contain ONLY a single raw JSON object matching the structure requested — no markdown formatting, no code fences, no commentary before or after it.`;

  const userPrompt = `Run exactly these 3 searches, then return this exact JSON structure (raw, no markdown):
{
  "timestamp": "${new Date().toISOString()}",
  "sessionDate": "${sessionDate}",
  "verdict": "bullish" or "bearish" or "uncertain",
  "confidence": "high" or "medium" or "low",
  "reasoning": "2-3 sentence plain-English summary focused on whether tonight looks like a normal technical session or one likely to be overridden by events",
  "spx": { "direction": "up/down/flat", "change": "+/-X.X%", "notes": "one sentence" },
  "events": [{ "time": "HH:MM UTC", "event": "name", "importance": "high/medium/low" }],
  "news": [{ "headline": "string", "impact": "bullish/bearish/neutral" }],
  "watchouts": ["specific thing to monitor 1", "specific thing to monitor 2"]
}

1. Latest S&P 500 close.
2. Economic events in the next 24 hours relevant to Japan/Asia/US markets (BOJ, Fed, major data releases).
3. Breaking news in the last 12 hours that could move Japanese equities (IPOs, geopolitical developments, trade news, major company news).`;

  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 1500,
        tools: [{
          type: "web_search_20250305",
          name: "web_search",
          max_uses: 5,
          allowed_domains: [
            "bloomberg.com",
            "cnbc.com",
            "investing.com",
            "tradingeconomics.com",
            "finance.yahoo.com",
            "asia.nikkei.com",
          ],
        }],
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || `API error (${res.status})`);

    const text = (data.content || [])
      .filter(b => b.type === "text")
      .map(b => b.text)
      .join("\n");

    const clean = text.replace(/```json|```/g, "").trim();
    const firstBrace = clean.indexOf("{");
    if (firstBrace === -1) throw new Error("No JSON in model response");

    let depth = 0, endIdx = -1;
    for (let i = firstBrace; i < clean.length; i++) {
      if (clean[i] === "{") depth++;
      else if (clean[i] === "}") { depth--; if (depth === 0) { endIdx = i; break; } }
    }
    if (endIdx === -1) throw new Error("Unbalanced JSON in response");

    const analysis = JSON.parse(clean.slice(firstBrace, endIdx + 1));

    // Store full analysis keyed by session date
    await kvSet(`nikkei:session:${sessionDate}`, analysis);

    // Maintain a list of session dates (most recent 90 sessions)
    const existingIndex = await kvGet("nikkei:sessions:index") || [];
    const index = [sessionDate, ...existingIndex.filter(d => d !== sessionDate)].slice(0, 90);
    await kvSet("nikkei:sessions:index", index);

    // Also update latest verdict for the 1:30am trade cron
    await kvSet("nikkei:verdict:latest", {
      verdict: analysis.verdict,
      confidence: analysis.confidence,
      reasoning: analysis.reasoning,
      timestamp: analysis.timestamp,
      storedAt: new Date().toISOString(),
    });

    return Response.json({ ok: true, sessionDate, verdict: analysis.verdict, confidence: analysis.confidence });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
