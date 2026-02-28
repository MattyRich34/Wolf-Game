import { useState } from "react";

const TOTAL_HOLES = 18;

function getOrder(initialOrder, hole) {
  const shift = (hole - 1) % 4;
  return [
    initialOrder[(0 + shift) % 4],
    initialOrder[(1 + shift) % 4],
    initialOrder[(2 + shift) % 4],
    initialOrder[(3 + shift) % 4],
  ];
}

// base points for each outcome type
const OUTCOME_TYPES = [
  { id: "partner",  label: "Partner Win",   basePoints: 2, partnerMode: true,  loss: false, tie: false },
  { id: "solo",     label: "Solo Win",       basePoints: 3, partnerMode: false, loss: false, tie: false },
  { id: "straddle", label: "Straddle Win",   basePoints: 4, partnerMode: false, loss: false, tie: false },
  { id: "tie_partner",  label: "Tie (Partner)",  basePoints: 2, partnerMode: false, loss: false, tie: true },
  { id: "tie_solo",     label: "Tie (Solo)",     basePoints: 3, partnerMode: false, loss: false, tie: true },
  { id: "tie_straddle", label: "Tie (Straddle)", basePoints: 4, partnerMode: false, loss: false, tie: true },
  { id: "loss_partner",  label: "Wolf Lost (Partner)", basePoints: 2, partnerMode: true,  loss: true,  tie: false },
  { id: "loss_solo",     label: "Wolf Lost (Solo)",    basePoints: 3, partnerMode: false, loss: true,  tie: false },
  { id: "loss_straddle", label: "Wolf Lost (Straddle)", basePoints: 4, partnerMode: false, loss: true,  tie: false },
];

export default function WolfTracker() {
  const [screen, setScreen] = useState("setup");
  const [names, setNames] = useState(["", "", "", ""]);
  const [initialOrder, setInitialOrder] = useState([0, 1, 2, 3]);
  const [currentHole, setCurrentHole] = useState(1);
  const [points, setPoints] = useState([0, 0, 0, 0]);
  const [carryover, setCarryover] = useState(0);
  const [history, setHistory] = useState([]);
  const [pendingOutcome, setPendingOutcome] = useState(null);
  const [pendingPartner, setPendingPartner] = useState(null);
  const [pendingTopScorers, setPendingTopScorers] = useState([]); // players getting extra pts on uneven split

  // Helper: compute split info for current selection
  function getSplitInfo(o, partner) {
    if (!o || o.tie) return null;
    const total = o.basePoints + carryover;
    let recipients = [];
    if (o.loss) {
      if (o.partnerMode && partner !== null) {
        // other two split
        recipients = order.slice(0, 3).filter(i => i !== partner);
      } else {
        // other three split
        recipients = [...order.slice(0, 3)];
      }
    } else {
      if (o.partnerMode && partner !== null) {
        recipients = [wolfIndex, partner];
      } else {
        // solo/straddle win — no split needed, wolf takes all
        return null;
      }
    }
    const n = recipients.length;
    const base = Math.floor(total / n);
    const remainder = total % n;
    return { total, recipients, base, remainder };
  }

  const order = getOrder(initialOrder, currentHole);
  const wolfIndex = order[3];

  function startGame() {
    if (names.some(n => !n.trim())) return;
    setScreen("game");
  }

  function randomizeOrder() {
    const arr = [0, 1, 2, 3];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    setInitialOrder(arr);
  }

  function recordHole() {
    if (!pendingOutcome) return;
    const o = pendingOutcome;
    const totalPoints = o.basePoints + carryover;
    const newPoints = [...points];

    if (o.tie) {
      setCarryover(totalPoints);
      setHistory([...history, {
        hole: currentHole, wolf: wolfIndex,
        outcome: o.label,
        partner: null, pointsAtStake: totalPoints, carried: totalPoints, delta: Array(4).fill(0),
      }]);
    } else {
      const delta = Array(4).fill(0);
      const split = getSplitInfo(o, pendingPartner);
      if (split) {
        split.recipients.forEach(i => {
          const extra = pendingTopScorers.includes(i) ? 1 : 0;
          newPoints[i] += split.base + extra;
          delta[i] = split.base + extra;
        });
      } else {
        newPoints[wolfIndex] += totalPoints;
        delta[wolfIndex] = totalPoints;
      }
      setPoints(newPoints);
      setCarryover(0);
      // Build a human-readable outcome label with actual partner name
      const outcomeLabel = o.partnerMode && pendingPartner !== null
        ? o.label.replace("Partner", names[pendingPartner])
        : o.label;
      setHistory([...history, {
        hole: currentHole, wolf: wolfIndex, outcome: outcomeLabel,
        partner: o.partnerMode ? pendingPartner : null,
        pointsAtStake: totalPoints, carried: 0, delta,
      }]);
    }

    setPendingOutcome(null);
    setPendingPartner(null);
    setPendingTopScorers([]);

    if (currentHole === TOTAL_HOLES) {
      setScreen("summary");
    } else {
      setCurrentHole(currentHole + 1);
    }
  }

  function resetAll() {
    setScreen("setup");
    setNames(["","","",""]);
    setPoints([0,0,0,0]);
    setCarryover(0);
    setHistory([]);
    setCurrentHole(1);
    setInitialOrder([0,1,2,3]);
    setPendingOutcome(null);
    setPendingPartner(null);
    setPendingTopScorers([]);
  }

  function undoLastHole() {
    if (history.length === 0) return;
    const last = history[history.length - 1];
    const newPoints = points.map((p, i) => p - last.delta[i]);
    setPoints(newPoints);
    setCurrentHole(last.hole);
    // Restore carryover to what it was before this hole
    const prevEntry = history.length > 1 ? history[history.length - 2] : null;
    setCarryover(prevEntry?.carried || 0);
    setHistory(history.slice(0, -1));
    setPendingOutcome(null);
    setPendingPartner(null);
    setPendingTopScorers([]);
  }

  const sortedPlayers = [...points.map((p, i) => ({ i, name: names[i], pts: p }))]
    .sort((a, b) => b.pts - a.pts);

  // Current hole points at stake (shown before outcome picked, based on selected outcome type)
  const holeValue = pendingOutcome ? pendingOutcome.basePoints + carryover : null;

  const nonWolves = order.slice(0, 3);

  // ---- SETUP SCREEN ----
  if (screen === "setup") {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <div style={styles.logo}>🐺</div>
          <h1 style={styles.title}>The Wolf</h1>
          <p style={styles.subtitle}>Golf Point Tracker</p>
          <div style={styles.divider} />
          <p style={styles.label}>Enter player names</p>
          {names.map((name, i) => (
            <div key={i} style={styles.inputRow}>
              <span style={styles.playerNum}>{i + 1}</span>
              <input
                style={styles.input}
                placeholder={`Player ${i + 1}`}
                value={name}
                onChange={e => {
                  const n = [...names];
                  n[i] = e.target.value;
                  setNames(n);
                }}
              />
            </div>
          ))}
          <button style={styles.secondaryBtn} onClick={randomizeOrder}>
            🔀 Randomize Tee Order
          </button>
          <div style={styles.orderPreview}>
            Hole 1 order: {initialOrder.map(i => names[i] || `P${i+1}`).join(" → ")}
          </div>
          <button
            style={{...styles.primaryBtn, opacity: names.some(n=>!n.trim()) ? 0.4 : 1}}
            onClick={startGame}
            disabled={names.some(n=>!n.trim())}
          >
            Start Round
          </button>
        </div>
      </div>
    );
  }

  // ---- SUMMARY SCREEN ----
  if (screen === "summary") {
    // Payout calculation
    const totalPts = points.reduce((a, b) => a + b, 0);
    const avg = totalPts / 4;
    const netDollars = points.map((p, i) => ({ i, name: names[i], net: p - avg }));

    // Minimum transactions settlement
    const settlements = [];
    const balances = netDollars.map(p => ({ ...p }));
    for (let rounds = 0; rounds < 10; rounds++) {
      const payers = balances.filter(p => p.net < -0.001).sort((a, b) => a.net - b.net);
      const collectors = balances.filter(p => p.net > 0.001).sort((a, b) => b.net - a.net);
      if (payers.length === 0 || collectors.length === 0) break;
      const payer = payers[0];
      const collector = collectors[0];
      const amount = Math.min(Math.abs(payer.net), collector.net);
      settlements.push({ from: payer.name, to: collector.name, amount });
      payer.net += amount;
      collector.net -= amount;
    }

    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <div style={styles.logo}>🏆</div>
          <h1 style={styles.title}>Round Over</h1>
          <div style={styles.divider} />
          {sortedPlayers.map((p, rank) => {
            const net = netDollars.find(n => n.i === p.i).net;
            return (
              <div key={p.i} style={{...styles.leaderRow, background: rank===0 ? "#f0f9eb" : "#fafafa"}}>
                <span style={styles.rank}>{rank === 0 ? "🥇" : rank === 1 ? "🥈" : rank === 2 ? "🥉" : "4th"}</span>
                <span style={styles.leaderName}>{p.name}</span>
                <span style={styles.leaderPts}>{p.pts} pts</span>
                <span style={{...styles.leaderNet, color: net >= 0 ? "#2a9d2a" : "#cc0000"}}>
                  {net >= 0 ? `+$${net.toFixed(2)}` : `-$${Math.abs(net).toFixed(2)}`}
                </span>
              </div>
            );
          })}
          {carryover > 0 && (
            <div style={styles.carryBanner}>
              ⚠️ {carryover} pts carried over from hole 18 — resolve with your group!
            </div>
          )}

          <div style={styles.divider} />
          <p style={styles.sectionLabel}>💸 PAYOUTS</p>
          {settlements.length === 0 ? (
            <p style={{fontFamily:"sans-serif", fontSize:13, color:"#999", textAlign:"center"}}>Everyone is even!</p>
          ) : (
            settlements.map((s, i) => (
              <div key={i} style={styles.payoutRow}>
                <span style={styles.payoutFrom}>{s.from}</span>
                <span style={styles.payoutArrow}>owes</span>
                <span style={styles.payoutTo}>{s.to}</span>
                <span style={styles.payoutAmount}>${s.amount.toFixed(2)}</span>
              </div>
            ))
          )}

          <div style={styles.divider} />
          <p style={styles.sectionLabel}>HOLE-BY-HOLE</p>
          <div style={styles.historyList}>
            {history.map((h, i) => (
              <div key={i} style={styles.historyRow}>
                <span style={styles.historyHole}>H{h.hole}</span>
                <span style={styles.historyWolf}>🐺 {names[h.wolf]}</span>
                <span style={styles.historyOutcome}>{h.outcome}</span>
                <span style={{...styles.historyPts, color: h.carried > 0 ? "#f0a500" : "#2a9d2a"}}>
                  {h.carried > 0 ? `+${h.carried} carry` : `${h.pointsAtStake}pts`}
                </span>
              </div>
            ))}
          </div>
          <button style={{...styles.primaryBtn, marginTop: 16}} onClick={resetAll}>
            New Round
          </button>
        </div>
      </div>
    );
  }

  // ---- GAME SCREEN ----
  return (
    <div style={styles.page}>
      <div style={styles.card}>
        {/* Header */}
        <div style={styles.holeHeader}>
          <div>
            <span style={styles.holeLabel}>HOLE</span>
            <span style={styles.holeNum}>{currentHole}</span>
            <span style={styles.holeOf}>/ {TOTAL_HOLES}</span>
          </div>
          <div style={{display:"flex", alignItems:"center", gap:8}}>
            {history.length > 0 && (
              <button style={styles.undoBtn} onClick={undoLastHole}>← Undo</button>
            )}
            <div style={styles.wolfBadge}>🐺 {names[wolfIndex]}</div>
          </div>
        </div>

        {/* Carryover banner */}
        {carryover > 0 && (
          <div style={styles.carryBanner}>
            🔥 {carryover} pts carrying in from previous hole{carryover > 2 ? "s" : ""}
          </div>
        )}

        {/* Tee Order */}
        <div style={styles.section}>
          <p style={styles.sectionLabel}>TEE ORDER</p>
          <div style={styles.teeOrder}>
            {order.map((playerIdx, pos) => (
              <div key={playerIdx} style={{...styles.teeSlot, background: pos === 3 ? "#1a1a1a" : "#f5f5f5"}}>
                <span style={{...styles.teePos, color: pos === 3 ? "#c8f56a" : "#999"}}>{pos + 1}</span>
                <span style={{...styles.teeName, color: pos === 3 ? "#fff" : "#111"}}>{names[playerIdx]}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Scoreboard */}
        <div style={styles.section}>
          <p style={styles.sectionLabel}>POINTS</p>
          <div style={styles.scoreGrid}>
            {sortedPlayers.map(p => (
              <div key={p.i} style={styles.scoreItem}>
                <span style={styles.scoreName}>{p.name}</span>
                <span style={styles.scoreVal}>{p.pts}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={styles.divider} />

        {/* Outcome selection — grouped */}
        <p style={styles.sectionLabel}>RECORD OUTCOME</p>

        <p style={styles.groupLabel}>✅ Wolf Wins</p>
        <div style={styles.outcomeGrid}>
          {OUTCOME_TYPES.filter(o => !o.loss && !o.tie).map((o, i) => {
            const val = o.basePoints + carryover;
            return (
              <button key={i}
                style={{...styles.outcomeBtn, ...(pendingOutcome?.id === o.id ? styles.outcomeBtnActive : {})}}
                onClick={() => { setPendingOutcome(o); setPendingPartner(null); setPendingTopScorers([]); }}
              >
                <span>{o.label}</span>
                <span style={styles.outcomePts}>{val} pt{val !== 1 ? "s" : ""}</span>
              </button>
            );
          })}
        </div>

        <p style={styles.groupLabel}>❌ Wolf Lost</p>
        <div style={styles.outcomeGrid}>
          {OUTCOME_TYPES.filter(o => o.loss).map((o, i) => {
            const val = o.basePoints + carryover;
            return (
              <button key={i}
                style={{...styles.outcomeBtn, ...(pendingOutcome?.id === o.id ? styles.outcomeBtnLoss : {})}}
                onClick={() => { setPendingOutcome(o); setPendingPartner(null); setPendingTopScorers([]); }}
              >
                <span>{o.label}</span>
                <span style={styles.outcomePts}>{val} pt{val !== 1 ? "s" : ""} to others</span>
              </button>
            );
          })}
        </div>

        <p style={styles.groupLabel}>😬 Tie — Carry Over</p>
        <div style={styles.outcomeGrid}>
          {OUTCOME_TYPES.filter(o => o.tie).map((o, i) => {
            return (
              <button key={i}
                style={{...styles.outcomeBtn, ...(pendingOutcome?.id === o.id ? styles.outcomeBtnTie : {})}}
                onClick={() => { setPendingOutcome(o); setPendingPartner(null); setPendingTopScorers([]); }}
              >
                <span>{o.label}</span>
                <span style={styles.outcomePts}>{o.basePoints} pts carry →</span>
              </button>
            );
          })}
        </div>

        {/* Partner selection */}
        {pendingOutcome?.partnerMode && !pendingOutcome.tie && (
          <div style={styles.section}>
            <p style={styles.sectionLabel}>SELECT PARTNER</p>
            <div style={styles.partnerGrid}>
              {nonWolves.map(pi => (
                <button
                  key={pi}
                  style={{...styles.partnerBtn, ...(pendingPartner === pi ? styles.partnerBtnActive : {})}}
                  onClick={() => { setPendingPartner(pi); setPendingTopScorers([]); }}
                >
                  {names[pi]}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Odd split — who had the better score(s)? */}
        {(() => {
          const split = getSplitInfo(pendingOutcome, pendingPartner);
          if (!split || split.remainder === 0) return null;
          if (pendingOutcome?.partnerMode && pendingPartner === null) return null; // wait for partner first
          const needed = split.remainder;
          return (
            <div style={styles.section}>
              <div style={styles.oddBanner}>
                ⚡ {split.total} pts ÷ {split.recipients.length} players — {needed} extra pt{needed > 1 ? "s" : ""}!
                Select the {needed === 1 ? "best scorer" : `best ${needed} scorers`}:
              </div>
              <div style={styles.partnerGrid}>
                {split.recipients.map(pi => {
                  const selected = pendingTopScorers.includes(pi);
                  return (
                    <button
                      key={pi}
                      style={{...styles.partnerBtn, ...(selected ? styles.partnerBtnActive : {})}}
                      onClick={() => {
                        if (selected) {
                          setPendingTopScorers(pendingTopScorers.filter(x => x !== pi));
                        } else if (pendingTopScorers.length < needed) {
                          setPendingTopScorers([...pendingTopScorers, pi]);
                        }
                      }}
                    >
                      {names[pi]}
                      <span style={{fontSize:11, opacity:0.7, marginLeft:4}}>
                        +{split.base + (selected ? 1 : 0)}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p style={{fontSize:11, color:"#aaa", fontFamily:"sans-serif", margin:"4px 0 0", textAlign:"center"}}>
                {pendingTopScorers.length}/{needed} selected
              </p>
            </div>
          );
        })()}

        {/* Points at stake summary */}
        {pendingOutcome && (
          <div style={styles.stakeRow}>
            <span style={styles.stakeLabel}>Points at stake this hole:</span>
            <span style={styles.stakeVal}>{holeValue}</span>
          </div>
        )}

        <button
          style={{
            ...styles.primaryBtn,
            marginTop: 12,
            opacity: (() => {
              if (!pendingOutcome) return 0.35;
              if (pendingOutcome.partnerMode && !pendingOutcome.tie && pendingPartner === null) return 0.35;
              const split = getSplitInfo(pendingOutcome, pendingPartner);
              if (split && split.remainder > 0 && pendingTopScorers.length < split.remainder) return 0.35;
              return 1;
            })()
          }}
          disabled={(() => {
            if (!pendingOutcome) return true;
            if (pendingOutcome.partnerMode && !pendingOutcome.tie && pendingPartner === null) return true;
            const split = getSplitInfo(pendingOutcome, pendingPartner);
            if (split && split.remainder > 0 && pendingTopScorers.length < split.remainder) return true;
            return false;
          })()}
          onClick={recordHole}
        >
          {pendingOutcome?.tie
            ? `Carry ${holeValue} pts to Hole ${currentHole + 1} →`
            : currentHole === TOTAL_HOLES
              ? "Finish Round →"
              : `Next Hole (${currentHole + 1}) →`}
        </button>
      </div>
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    background: "#f2f2ef",
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "center",
    padding: "24px 16px",
    fontFamily: "'Georgia', serif",
  },
  card: {
    background: "#fff",
    borderRadius: 16,
    padding: "28px 24px",
    width: "100%",
    maxWidth: 420,
    boxShadow: "0 2px 20px rgba(0,0,0,0.08)",
  },
  logo: { textAlign: "center", fontSize: 40, marginBottom: 4 },
  title: { textAlign: "center", fontSize: 28, fontWeight: "bold", margin: 0, letterSpacing: -1, color: "#111" },
  subtitle: { textAlign: "center", color: "#888", fontSize: 14, margin: "4px 0 0", fontFamily: "sans-serif" },
  divider: { height: 1, background: "#eee", margin: "20px 0" },
  label: { fontSize: 13, fontWeight: "bold", color: "#555", letterSpacing: 1, textTransform: "uppercase", fontFamily: "sans-serif", marginBottom: 10 },
  inputRow: { display: "flex", alignItems: "center", gap: 10, marginBottom: 10 },
  playerNum: { width: 24, height: 24, background: "#111", color: "#fff", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontFamily: "sans-serif", flexShrink: 0 },
  input: { flex: 1, padding: "10px 14px", border: "1.5px solid #e0e0e0", borderRadius: 8, fontSize: 15, fontFamily: "sans-serif", outline: "none" },
  secondaryBtn: { width: "100%", padding: "10px", border: "1.5px solid #ddd", borderRadius: 8, background: "#fafafa", fontSize: 14, cursor: "pointer", fontFamily: "sans-serif", marginBottom: 8 },
  orderPreview: { textAlign: "center", fontSize: 12, color: "#999", fontFamily: "sans-serif", marginBottom: 16 },
  primaryBtn: { width: "100%", padding: "14px", background: "#111", color: "#fff", border: "none", borderRadius: 10, fontSize: 15, cursor: "pointer", fontFamily: "sans-serif", fontWeight: "bold", transition: "opacity 0.2s" },
  holeHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 },
  holeLabel: { fontSize: 11, color: "#999", fontFamily: "sans-serif", letterSpacing: 2, display: "block" },
  holeNum: { fontSize: 36, fontWeight: "bold", color: "#111", lineHeight: 1 },
  holeOf: { fontSize: 16, color: "#bbb", marginLeft: 4 },
  wolfBadge: { background: "#1a1a1a", color: "#c8f56a", padding: "6px 12px", borderRadius: 20, fontSize: 13, fontFamily: "sans-serif" },
  undoBtn: { padding: "6px 12px", border: "1.5px solid #ddd", borderRadius: 20, background: "#fff", fontSize: 13, cursor: "pointer", fontFamily: "sans-serif", color: "#555" },
  section: { marginBottom: 16 },
  sectionLabel: { fontSize: 11, letterSpacing: 2, color: "#999", textTransform: "uppercase", fontFamily: "sans-serif", marginBottom: 8, marginTop: 0 },
  teeOrder: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 },
  teeSlot: { borderRadius: 8, padding: "10px 12px", display: "flex", alignItems: "center", gap: 8 },
  teePos: { fontSize: 11, fontWeight: "bold", fontFamily: "sans-serif", letterSpacing: 1 },
  teeName: { fontSize: 14, fontFamily: "sans-serif" },
  scoreGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 },
  scoreItem: { background: "#f9f9f9", borderRadius: 8, padding: "8px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" },
  scoreName: { fontSize: 13, fontFamily: "sans-serif", color: "#444" },
  scoreVal: { fontSize: 18, fontWeight: "bold", color: "#111" },
  outcomeGrid: { display: "flex", flexDirection: "column", gap: 7, marginBottom: 8 },
  outcomeBtn: { padding: "10px 14px", border: "1.5px solid #e0e0e0", borderRadius: 8, background: "#fff", fontSize: 14, cursor: "pointer", textAlign: "left", fontFamily: "sans-serif", transition: "all 0.15s", display: "flex", justifyContent: "space-between", alignItems: "center" },
  outcomeBtnActive: { border: "1.5px solid #111", background: "#111", color: "#fff" },
  partnerGrid: { display: "flex", gap: 8 },
  partnerBtn: { flex: 1, padding: "10px", border: "1.5px solid #e0e0e0", borderRadius: 8, background: "#fff", fontSize: 14, cursor: "pointer", fontFamily: "sans-serif" },
  partnerBtnActive: { border: "1.5px solid #111", background: "#111", color: "#fff" },
  leaderRow: { display: "flex", alignItems: "center", padding: "12px 14px", borderRadius: 10, marginBottom: 8 },
  rank: { fontSize: 20, marginRight: 12 },
  leaderName: { flex: 1, fontSize: 16, fontFamily: "sans-serif" },
  leaderPts: { fontSize: 20, fontWeight: "bold", fontFamily: "sans-serif" },
  leaderNet: { fontSize: 13, fontWeight: "bold", fontFamily: "sans-serif", marginLeft: 8, minWidth: 50, textAlign: "right" },
  payoutRow: { display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: "#fafafa", borderRadius: 10, marginBottom: 8 },
  payoutFrom: { fontWeight: "bold", fontFamily: "sans-serif", fontSize: 14, color: "#cc0000", flex: 1 },
  payoutArrow: { fontSize: 12, color: "#999", fontFamily: "sans-serif" },
  payoutTo: { fontWeight: "bold", fontFamily: "sans-serif", fontSize: 14, color: "#2a9d2a", flex: 1, textAlign: "center" },
  payoutAmount: { fontWeight: "bold", fontFamily: "sans-serif", fontSize: 18, color: "#111", minWidth: 60, textAlign: "right" },
  groupLabel: { fontSize: 12, fontWeight: "bold", color: "#666", fontFamily: "sans-serif", margin: "10px 0 6px", letterSpacing: 0.5 },
  carryBanner: { background: "#fff8e6", border: "1.5px solid #f0c040", borderRadius: 8, padding: "8px 12px", fontSize: 13, fontFamily: "sans-serif", color: "#7a5a00", marginBottom: 12, textAlign: "center" },
  outcomeBtnTie: { border: "1.5px solid #f0a500", background: "#fff8e6", color: "#7a5a00" },
  outcomeBtnLoss: { border: "1.5px solid #d00", background: "#fff0f0", color: "#900" },
  stakeRow: { display: "flex", justifyContent: "space-between", alignItems: "center", background: "#f5f5f5", borderRadius: 8, padding: "8px 14px", marginTop: 8 },
  stakeLabel: { fontSize: 13, fontFamily: "sans-serif", color: "#555" },
  stakeVal: { fontSize: 20, fontWeight: "bold", color: "#111" },
  historyList: { maxHeight: 200, overflowY: "auto" },
  historyRow: { display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderBottom: "1px solid #f0f0f0", fontSize: 12, fontFamily: "sans-serif" },
  historyHole: { width: 28, color: "#999", flexShrink: 0 },
  historyWolf: { width: 80, color: "#444", flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  historyOutcome: { flex: 1, color: "#666" },
  historyPts: { fontWeight: "bold", flexShrink: 0 },
  oddBanner: { background: "#f0f0ff", border: "1.5px solid #aab", borderRadius: 8, padding: "8px 12px", fontSize: 13, fontFamily: "sans-serif", color: "#334", marginBottom: 8, textAlign: "center" },
};
