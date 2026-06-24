"use client";

import { useState, useEffect } from "react";
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts";

const STORAGE_KEY = "nikkei-analysis-log";
const HISTORY_SIGNALS_KEY = "nikkei-history-signals";

const C = {
  bg: "#0A0E14", surface: "#131920", border: "#1E2730",
  textPrimary: "#E8EEF4", textSecondary: "#7A8A99", textMuted: "#4A5A68",
  bullish: "#2ECC71", bearish: "#E74C3C", uncertain: "#F39C12", accent: "#3498DB",
  bullishBg: "rgba(46,204,113,0.08)", bearishBg: "rgba(231,76,60,0.08)", uncertainBg: "rgba(243,156,18,0.08)",
};

const vColor = { bullish: C.bullish, bearish: C.bearish, uncertain: C.uncertain };
const vBg = { bullish: C.bullishBg, bearish: C.bearishBg, uncertain: C.uncertainBg };
const impColor = { bullish: C.bullish, bearish: C.bearish, neutral: C.textMuted };
const impDot = { high: C.bearish, medium: C.uncertain, low: C.textMuted };

export default function NikkeiDashboard() {
  const [tab, setTab] = useState("dashboard");

  // Dashboard state
  const [chartData, setChartData] = useState(null);
  const [chartLoading, setChartLoading] = useState(false);
  const [chartError, setChartError] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [outcomeInput, setOutcomeInput] = useState({});

  // History tab state
  const [sessions, setSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState(null);
  const [sessionIdx, setSessionIdx] = useState(0);
  const [signals, setSignals] = useState({});

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setHistory(JSON.parse(raw));
      const sig = localStorage.getItem(HISTORY_SIGNALS_KEY);
      if (sig) setSignals(JSON.parse(sig));
    } catch (_) {}
  }, []);

  function persistHistory(updated) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(updated)); } catch (_) {}
  }

  function persistSignals(updated) {
    try { localStorage.setItem(HISTORY_SIGNALS_KEY, JSON.stringify(updated)); } catch (_) {}
  }

  async function loadChart() {
    setChartLoading(true); setChartError(null);
    try {
      const res = await fetch("/api/chart");
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Chart failed");
      setChartData(data.points);
    } catch (err) { setChartError(err.message); }
    finally { setChartLoading(false); }
  }

  async function runAnalysis() {
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/analyze");
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Analysis failed");
      setAnalysis(data);
      const updated = [{ ...data, outcome: null }, ...history].slice(0, 90);
      setHistory(updated); persistHistory(updated);
    } catch (err) { setError("Analysis failed — " + err.message); }
    finally { setLoading(false); }
  }

  function runAll() { loadChart(); runAnalysis(); }

  function saveOutcome(index) {
    const o = outcomeInput[index];
    if (!o?.direction) return;
    const updated = history.map((h, i) => i === index ? { ...h, outcome: o } : h);
    setHistory(updated); persistHistory(updated);
  }

  async function loadSessions() {
    setSessionsLoading(true); setSessionsError(null);
    try {
      const res = await fetch("/api/history");
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "History failed");
      setSessions(data.sessions);
      setSessionIdx(0);
    } catch (err) { setSessionsError(err.message); }
    finally { setSessionsLoading(false); }
  }

  function saveSignal(date, preSignal) {
    const updated = { ...signals, [date]: preSignal };
    setSignals(updated); persistSignals(updated);
  }

  const fmt = (iso) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const fmtDate = (d) => new Date(d).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  const chartUp = chartData && chartData.length > 1 && chartData[chartData.length - 1].price >= chartData[0].price;

  // Accuracy stats
  const scored = sessions.filter(s => signals[s.date]);
  const correct = scored.filter(s => signals[s.date] === s.direction).length;
  const accuracy = scored.length > 0 ? Math.round((correct / scored.length) * 100) : null;

  const s = {
    root: { background: C.bg, minHeight: "100vh", color: C.textPrimary, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", maxWidth: 520, margin: "0 auto", paddingBottom: 48 },
    header: { padding: "18px 16px 0", borderBottom: `1px solid ${C.border}` },
    topRow: { display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: 14 },
    title: { fontSize: 16, fontWeight: 700, color: C.textPrimary, margin: 0 },
    sub: { fontSize: 11, color: C.textMuted, fontFamily: "monospace", margin: 0 },
    btn: (d) => ({ background: d ? C.border : C.accent, color: d ? C.textMuted : "#fff", border: "none", borderRadius: 6, padding: "9px 18px", fontSize: 13, fontWeight: 600, cursor: d ? "not-allowed" : "pointer" }),
    tabs: { display: "flex", gap: 0 },
    tab: (active) => ({ background: "none", border: "none", borderBottom: active ? `2px solid ${C.accent}` : "2px solid transparent", color: active ? C.accent : C.textMuted, padding: "10px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" }),
    body: { padding: "14px 16px 0" },
    card: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14, marginBottom: 10 },
    label: { fontSize: 10, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 600, margin: "0 0 6px" },
    vCard: (v) => ({ background: vBg[v] || C.surface, border: `1px solid ${vColor[v] || C.border}`, borderRadius: 10, padding: 16, marginBottom: 10 }),
    vText: (v) => ({ fontSize: 30, fontWeight: 800, color: vColor[v] || C.textPrimary, textTransform: "uppercase", margin: "0 0 6px" }),
    badge: (v) => ({ display: "inline-block", fontSize: 10, fontWeight: 600, padding: "3px 9px", borderRadius: 12, background: vBg[v] || "transparent", color: vColor[v] || C.textMuted, textTransform: "uppercase", border: `1px solid ${vColor[v] || C.border}` }),
    reasoning: { fontSize: 13, color: "#B8C4CE", lineHeight: 1.55, margin: "10px 0 0" },
    row: (last) => ({ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderBottom: last ? "none" : `1px solid ${C.border}` }),
    evtRow: (last) => ({ display: "flex", gap: 8, padding: "7px 0", borderBottom: last ? "none" : `1px solid ${C.border}`, alignItems: "flex-start" }),
    dot: (imp) => ({ width: 7, height: 7, borderRadius: "50%", background: impDot[imp] || C.textMuted, marginTop: 4, flexShrink: 0 }),
    newsRow: (last) => ({ padding: "8px 0", borderBottom: last ? "none" : `1px solid ${C.border}` }),
    watchout: { fontSize: 12, color: "#B8C4CE", padding: "3px 0", display: "flex", gap: 6 },
    ts: { fontSize: 11, color: C.textMuted, fontFamily: "monospace", padding: "2px 0 14px" },
    histBtn: { background: "none", border: `1px solid ${C.border}`, color: C.textSecondary, borderRadius: 8, padding: "10px 16px", fontSize: 12, cursor: "pointer", width: "100%", marginBottom: 12 },
    histItem: { padding: "12px 0", borderBottom: `1px solid ${C.border}` },
    outcomeRow: { display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginTop: 6 },
    select: { background: C.border, border: "none", color: C.textPrimary, borderRadius: 4, padding: "4px 8px", fontSize: 11 },
    input: { background: C.border, border: "none", color: C.textPrimary, borderRadius: 4, padding: "4px 8px", fontSize: 11, width: 70 },
    saveBtn: { background: C.accent, color: "#fff", border: "none", borderRadius: 4, padding: "4px 10px", fontSize: 11, cursor: "pointer" },
    outcomeSet: (v) => ({ fontSize: 11, fontWeight: 600, color: vColor[v] || C.bullish, padding: "3px 8px", background: vBg[v] || C.bullishBg, borderRadius: 4 }),
    empty: { textAlign: "center", padding: "40px 24px", color: C.textSecondary },
    errBox: { background: "rgba(231,76,60,0.08)", border: "1px solid rgba(231,76,60,0.25)", borderRadius: 8, padding: "12px 14px", margin: "12px 16px", fontSize: 12, color: C.bearish, lineHeight: 1.5 },
    spinSm: { fontSize: 12, color: C.textMuted, padding: "30px 0", textAlign: "center" },
    navRow: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
    navBtn: (d) => ({ background: d ? C.border : C.surface, border: `1px solid ${C.border}`, color: d ? C.textMuted : C.textPrimary, borderRadius: 6, padding: "7px 14px", fontSize: 12, cursor: d ? "not-allowed" : "pointer" }),
    statRow: { display: "flex", gap: 10, marginBottom: 12 },
    stat: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 14px", flex: 1, textAlign: "center" },
    statNum: { fontSize: 22, fontWeight: 700, color: C.textPrimary },
    statLabel: { fontSize: 10, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.07em" },
  };

  const session = sessions[sessionIdx];

  return (
    <div style={s.root}>
      <div style={s.header}>
        <div style={s.topRow}>
          <div>
            <p style={s.title}>Japan 225 · Pre-Open</p>
            <p style={s.sub}>1am BST · Tokyo Direction Signal</p>
          </div>
          {tab === "dashboard" && (
            <button style={s.btn(loading || chartLoading)} onClick={runAll} disabled={loading || chartLoading}>
              {loading || chartLoading ? "Running..." : "Analyse"}
            </button>
          )}
        </div>
        <div style={s.tabs}>
          <button style={s.tab(tab === "dashboard")} onClick={() => setTab("dashboard")}>Dashboard</button>
          <button style={s.tab(tab === "history")} onClick={() => { setTab("history"); if (sessions.length === 0) loadSessions(); }}>
            30-Day History
          </button>
        </div>
      </div>

      {/* ── DASHBOARD TAB ── */}
      {tab === "dashboard" && (
        <>
          <div style={{ ...s.card, margin: "14px 16px 0" }}>
            <p style={s.label}>Nikkei 225 · Last Session (30m)</p>
            {chartError && <p style={{ fontSize: 12, color: C.bearish, lineHeight: 1.5 }}>{chartError}</p>}
            {chartLoading && <p style={s.spinSm}>Loading chart…</p>}
            {!chartLoading && chartData?.length > 0 && (
              <div style={{ height: 180, marginTop: 6 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
                    <XAxis dataKey="time" tick={{ fontSize: 9, fill: C.textMuted }} interval="preserveStartEnd" axisLine={{ stroke: C.border }} tickLine={false} />
                    <YAxis domain={["auto", "auto"]} tick={{ fontSize: 9, fill: C.textMuted }} axisLine={false} tickLine={false} width={48} />
                    <Tooltip contentStyle={{ background: C.surface, border: `1px solid ${C.border}`, fontSize: 11, borderRadius: 6 }} labelStyle={{ color: C.textSecondary }} />
                    <Line type="monotone" dataKey="price" stroke={chartUp ? C.bullish : C.bearish} strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
            {!chartLoading && !chartData && !chartError && <p style={s.spinSm}>Tap Analyse to load the chart</p>}
          </div>

          {error && <div style={s.errBox}>{error}</div>}

          {!analysis && !loading && !error && (
            <div style={s.empty}>
              <p style={{ fontSize: 16, fontWeight: 600, color: C.textPrimary, marginBottom: 8 }}>Ready to analyse</p>
              <p style={{ fontSize: 13, lineHeight: 1.6 }}>Tap Analyse to pull the live Nikkei chart, S&amp;P 500 close, scheduled economic events and breaking news.</p>
            </div>
          )}

          {loading && !analysis && <div style={s.spinSm}>Searching events &amp; news…</div>}

          {analysis && !loading && (
            <div style={s.body}>
              <div style={s.vCard(analysis.verdict)}>
                <p style={s.label}>Direction Verdict</p>
                <p style={s.vText(analysis.verdict)}>{analysis.verdict}</p>
                <span style={s.badge(analysis.verdict)}>{analysis.confidence} confidence</span>
                <p style={s.reasoning}>{analysis.reasoning}</p>
              </div>

              {analysis.spx && (
                <div style={s.card}>
                  <p style={s.label}>S&amp;P 500 Close</p>
                  <div style={s.row(true)}>
                    <span style={{ fontSize: 12, color: C.textSecondary }}>{analysis.spx.notes}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, fontFamily: "monospace", color: analysis.spx.direction === "up" ? C.bullish : C.bearish }}>{analysis.spx.change}</span>
                  </div>
                </div>
              )}

              {analysis.events?.length > 0 && (
                <div style={s.card}>
                  <p style={s.label}>Economic Events · Next 24h</p>
                  {analysis.events.map((ev, i) => (
                    <div key={i} style={s.evtRow(i === analysis.events.length - 1)}>
                      <div style={s.dot(ev.importance)} />
                      <span style={{ fontSize: 11, fontFamily: "monospace", color: C.textMuted, minWidth: 48, paddingTop: 1 }}>{ev.time}</span>
                      <span style={{ fontSize: 12, color: "#B8C4CE", flex: 1 }}>{ev.event}</span>
                    </div>
                  ))}
                </div>
              )}

              {analysis.news?.length > 0 && (
                <div style={s.card}>
                  <p style={s.label}>Market News</p>
                  {analysis.news.map((item, i) => (
                    <div key={i} style={s.newsRow(i === analysis.news.length - 1)}>
                      <p style={{ fontSize: 12, color: "#B8C4CE", lineHeight: 1.45, margin: 0 }}>{item.headline}</p>
                      <p style={{ fontSize: 10, fontWeight: 600, color: impColor[item.impact] || C.textMuted, textTransform: "uppercase", letterSpacing: "0.07em", marginTop: 3 }}>{item.impact}</p>
                    </div>
                  ))}
                </div>
              )}

              {analysis.watchouts?.length > 0 && (
                <div style={s.card}>
                  <p style={s.label}>Watch For</p>
                  {analysis.watchouts.map((w, i) => (
                    <div key={i} style={s.watchout}>
                      <span style={{ color: C.accent, flexShrink: 0 }}>›</span><span>{w}</span>
                    </div>
                  ))}
                </div>
              )}

              <p style={s.ts}>Analysed {fmt(analysis.timestamp)}</p>
            </div>
          )}

          {history.length > 0 && (
            <div style={{ padding: "0 16px" }}>
              <button style={s.histBtn} onClick={() => setShowHistory(!showHistory)}>
                {showHistory ? "Hide" : "Show"} Verdict Log ({history.length} sessions)
              </button>
              {showHistory && history.map((item, i) => (
                <div key={i} style={{ ...s.histItem, borderBottom: i === history.length - 1 ? "none" : `1px solid ${C.border}` }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: vColor[item.verdict] || C.textPrimary, textTransform: "uppercase" }}>{item.verdict}</span>
                    <span style={{ fontSize: 11, color: C.textMuted, fontFamily: "monospace" }}>{fmt(item.timestamp)}</span>
                  </div>
                  <p style={{ fontSize: 11, color: C.textMuted, margin: "2px 0 6px" }}>{item.confidence} confidence · SPX {item.spx?.change || "—"}</p>
                  {item.outcome ? (
                    <span style={s.outcomeSet(item.outcome.direction)}>Actual: {item.outcome.direction}{item.outcome.points ? ` · ${item.outcome.points}pts` : ""}</span>
                  ) : (
                    <div style={s.outcomeRow}>
                      <span style={{ fontSize: 11, color: C.textMuted }}>What happened?</span>
                      <select style={s.select} value={outcomeInput[i]?.direction || ""} onChange={e => setOutcomeInput(p => ({ ...p, [i]: { ...p[i], direction: e.target.value } }))}>
                        <option value="">direction</option>
                        <option value="bullish">Up</option>
                        <option value="bearish">Down</option>
                        <option value="uncertain">Flat</option>
                      </select>
                      <input style={s.input} type="number" placeholder="pts" value={outcomeInput[i]?.points || ""} onChange={e => setOutcomeInput(p => ({ ...p, [i]: { ...p[i], points: e.target.value } }))} />
                      <button style={s.saveBtn} onClick={() => saveOutcome(i)} disabled={!outcomeInput[i]?.direction}>Save</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── HISTORY TAB ── */}
      {tab === "history" && (
        <div style={s.body}>
          {sessionsError && <div style={{ ...s.errBox, margin: "12px 0" }}>{sessionsError}</div>}
          {sessionsLoading && <div style={s.spinSm}>Loading 30 days of Nikkei data…</div>}

          {!sessionsLoading && sessions.length === 0 && !sessionsError && (
            <div style={s.empty}>
              <p style={{ fontSize: 14, color: C.textPrimary, marginBottom: 8 }}>No history loaded yet</p>
              <button style={{ ...s.saveBtn, fontSize: 13, padding: "10px 20px" }} onClick={loadSessions}>Load 30-Day History</button>
            </div>
          )}

          {sessions.length > 0 && (
            <>
              {/* Accuracy stats */}
              <div style={s.statRow}>
                <div style={s.stat}>
                  <div style={s.statNum}>{sessions.length}</div>
                  <div style={s.statLabel}>Sessions</div>
                </div>
                <div style={s.stat}>
                  <div style={s.statNum}>{scored.length}</div>
                  <div style={s.statLabel}>Assessed</div>
                </div>
                <div style={s.stat}>
                  <div style={{ ...s.statNum, color: accuracy !== null ? (accuracy >= 60 ? C.bullish : accuracy >= 40 ? C.uncertain : C.bearish) : C.textPrimary }}>
                    {accuracy !== null ? `${accuracy}%` : "—"}
                  </div>
                  <div style={s.statLabel}>Accuracy</div>
                </div>
              </div>

              {/* Navigation */}
              <div style={s.navRow}>
                <button style={s.navBtn(sessionIdx >= sessions.length - 1)} onClick={() => setSessionIdx(i => Math.min(sessions.length - 1, i + 1))} disabled={sessionIdx >= sessions.length - 1}>← Older</button>
                <span style={{ fontSize: 12, color: C.textSecondary }}>{sessionIdx + 1} / {sessions.length}</span>
                <button style={s.navBtn(sessionIdx === 0)} onClick={() => setSessionIdx(i => Math.max(0, i - 1))} disabled={sessionIdx === 0}>Newer →</button>
              </div>

              {session && (
                <div style={s.card}>
                  {/* Date + actual outcome */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <p style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary, margin: 0 }}>{fmtDate(session.date)}</p>
                    <span style={s.badge(session.direction)}>{session.direction}</span>
                  </div>

                  {/* Actual move */}
                  <p style={{ fontSize: 11, color: C.textMuted, marginBottom: 10 }}>
                    1am open: {session.openPrice?.toLocaleString()} · Move by 3am: {session.pointsMoved !== null ? (session.pointsMoved > 0 ? "+" : "") + session.pointsMoved + " pts" : "—"}
                  </p>

                  {/* Session chart */}
                  <div style={{ height: 160, marginBottom: 12 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={session.candles} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                        <XAxis dataKey="time" tick={{ fontSize: 8, fill: C.textMuted }} interval="preserveStartEnd" axisLine={{ stroke: C.border }} tickLine={false} />
                        <YAxis domain={["auto", "auto"]} tick={{ fontSize: 8, fill: C.textMuted }} axisLine={false} tickLine={false} width={44} />
                        <Tooltip contentStyle={{ background: C.surface, border: `1px solid ${C.border}`, fontSize: 10, borderRadius: 6 }} labelStyle={{ color: C.textSecondary }} />
                        <Line type="monotone" dataKey="price" stroke={vColor[session.direction] || C.accent} strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Pre-signal assessment */}
                  <p style={{ ...s.label, marginBottom: 6 }}>What did the pre-signal suggest?</p>
                  <div style={{ display: "flex", gap: 6 }}>
                    {["bullish", "bearish", "uncertain"].map(v => (
                      <button
                        key={v}
                        onClick={() => saveSignal(session.date, v)}
                        style={{
                          flex: 1, padding: "7px 0", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer", textTransform: "uppercase",
                          background: signals[session.date] === v ? vBg[v] : "none",
                          border: `1px solid ${signals[session.date] === v ? vColor[v] : C.border}`,
                          color: signals[session.date] === v ? vColor[v] : C.textMuted,
                        }}
                      >{v}</button>
                    ))}
                  </div>

                  {/* Match indicator */}
                  {signals[session.date] && (
                    <p style={{ fontSize: 11, marginTop: 8, color: signals[session.date] === session.direction ? C.bullish : C.bearish }}>
                      {signals[session.date] === session.direction ? "✓ Signal matched outcome" : "✗ Signal did not match outcome"}
                    </p>
                  )}
                </div>
              )}

              <button style={{ ...s.histBtn, marginTop: 4 }} onClick={loadSessions}>↻ Refresh data</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
