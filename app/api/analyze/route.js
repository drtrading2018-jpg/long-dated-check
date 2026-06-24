export async function GET() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return Response.json({ error: "ANTHROPIC_API_KEY is not set on the server" }, { status: 500 });
  }

  const systemPrompt = `You are a financial market analyst specialising in the Japan 225 (Nikkei) index. The user monitors the Nikkei 225 around the Tokyo open (1am UK BST / 9am JST) for a 500+ point directional move.
Their research shows the single biggest cause of unexpected moves is scheduled macro events (BOJ, Fed, major data) or breaking news (IPOs, geopolitical events) — not USD/JPY correlation, which they've ruled out as unreliable.
Focus entirely on identifying anything that could override the normal technical pattern tonight.

After you finish searching, your FINAL message must contain ONLY a single raw JSON object matching the structure requested — no markdown formatting, no code fences, no commentary before or after it.`;

  const userPrompt = `Search the web and return this exact JSON structure (raw, no markdown):
{
  "timestamp": "${new Date().toISOString()}",
  "verdict": "bullish" or "bearish" or "uncertain",
  "confidence": "high" or "medium" or "low",
  "reasoning": "2-3 sentence plain-English summary focused on whether tonight looks like a 'normal' technical session or one likely to be overridden by events",
  "spx": { "direction": "up/down/flat", "change": "+/-X.X%", "notes": "one sentence" },
  "events": [{ "time": "HH:MM UTC", "event": "name", "importance": "high/medium/low" }],
  "news": [{ "headline": "string", "impact": "bullish/bearish/neutral" }],
  "watchouts": ["specific thing to monitor 1", "specific thing to monitor 2"]
}

Search for: latest S&P 500 close, economic events in the next 24 hours relevant to Japan/Asia/US markets (BOJ, Fed, major data releases), and any breaking news in the last 12 hours that could move Japanese equities (IPOs, geopolitical developments, trade news, major company news).`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 1500,
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      return Response.json({ error: data.error?.message || `API error (${res.status})` }, { status: 502 });
    }

    const text = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    const clean = text.replace(/```json|```/g, "").trim();
    const firstBrace = clean.indexOf("{");
    if (firstBrace === -1) {
      return Response.json({ error: "No JSON found in model reply", raw: clean.slice(0, 300) }, { status: 502 });
    }

    let depth = 0, endIdx = -1;
    for (let i = firstBrace; i < clean.length; i++) {
      if (clean[i] === "{") depth++;
      else if (clean[i] === "}") { depth--; if (depth === 0) { endIdx = i; break; } }
    }
    if (endIdx === -1) {
      return Response.json({ error: "Unbalanced JSON in model reply" }, { status: 502 });
    }

    const parsed = JSON.parse(clean.slice(firstBrace, endIdx + 1));
    return Response.json(parsed);
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
