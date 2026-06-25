// Shared IG API authentication
// Credentials stored as Vercel environment variables — never in code

export async function getIGSession() {
  const baseUrl = process.env.IG_BASE_URL || "https://demo-api.ig.com/gateway/deal";
  const apiKey = process.env.IG_API_KEY;
  const username = process.env.IG_USERNAME;
  const password = process.env.IG_PASSWORD;

  if (!apiKey || !username || !password) {
    throw new Error("IG credentials not set — check IG_API_KEY, IG_USERNAME, IG_PASSWORD in Vercel environment variables");
  }

  const res = await fetch(`${baseUrl}/session`, {
    method: "POST",
    headers: {
      "X-IG-API-KEY": apiKey,
      "Content-Type": "application/json; charset=UTF-8",
      "Accept": "application/json; charset=UTF-8",
      "Version": "2",
    },
    body: JSON.stringify({ identifier: username, password }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`IG login failed (${res.status}): ${body.slice(0, 200)}`);
  }

  const cst = res.headers.get("CST");
  const token = res.headers.get("X-SECURITY-TOKEN");

  if (!cst || !token) {
    throw new Error("IG login succeeded but no session tokens returned");
  }

  return { cst, token, baseUrl, apiKey };
}

// Parse IG snapshotTime "2026/06/23 01:00:00:000" into a Date
export function parseIGTime(snapshotTime) {
  const [datePart, timePart] = snapshotTime.split(" ");
  const [year, month, day] = datePart.split("/");
  const [hour, min] = timePart.split(":");
  return new Date(`${year}-${month}-${day}T${String(hour).padStart(2,"0")}:${String(min).padStart(2,"0")}:00Z`);
}

// Format a UTC Date as BST time label e.g. "23 Jun 01:00"
export function toBSTLabel(d) {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" })
    + " "
    + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
}
