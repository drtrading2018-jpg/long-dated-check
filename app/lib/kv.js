// Simple Upstash Redis REST client
// Environment variables auto-added by Vercel when connecting Upstash for Redis

async function upstash(command, ...args) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;

  if (!url || !token) {
    throw new Error("KV_REST_API_URL and KV_REST_API_TOKEN must be set — connect Upstash for Redis in Vercel Storage settings");
  }

  const res = await fetch(`${url}/${[command, ...args].map(encodeURIComponent).join("/")}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Upstash error (${res.status}): ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  return data.result;
}

export async function kvSet(key, value) {
  return upstash("SET", key, typeof value === "string" ? value : JSON.stringify(value));
}

export async function kvGet(key) {
  const result = await upstash("GET", key);
  if (!result) return null;
  try { return JSON.parse(result); }
  catch (_) { return result; }
}
