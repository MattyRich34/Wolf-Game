import { useState, useEffect } from "react";
import { db } from "./firebase";
import { ref, set, onValue, get, remove, update } from "firebase/database";

const TOTAL_HOLES = 18;

function getOrder(initialOrder, hole, numPlayers) {
  const shift = (hole - 1) % numPlayers;
  return Array.from({ length: numPlayers }, (_, i) => initialOrder[(i + shift) % numPlayers]);
}

const OUTCOME_TYPES = [
  { id: "partner",       label: "Partner Win",          basePoints: 2, partnerMode: true,  loss: false, tie: false },
  { id: "solo",          label: "Solo Win",              basePoints: 3, partnerMode: false, loss: false, tie: false },
  { id: "straddle",      label: "Straddle Win",          basePoints: 4, partnerMode: false, loss: false, tie: false },
  { id: "tie_partner",   label: "Tie (Partner)",         basePoints: 2, partnerMode: false, loss: false, tie: true },
  { id: "tie_solo",      label: "Tie (Solo)",            basePoints: 3, partnerMode: false, loss: false, tie: true },
  { id: "tie_straddle",  label: "Tie (Straddle)",        basePoints: 4, partnerMode: false, loss: false, tie: true },
  { id: "loss_partner",  label: "Wolf Lost (Partner)",   basePoints: 2, partnerMode: true,  loss: true,  tie: false },
  { id: "loss_solo",     label: "Wolf Lost (Solo)",      basePoints: 3, partnerMode: false, loss: true,  tie: false },
  { id: "loss_straddle", label: "Wolf Lost (Straddle)",  basePoints: 4, partnerMode: false, loss: true,  tie: false },
];

function generateRoomCode() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

function sanitizeKey(name) {
  return name.trim().toLowerCase().replace(/[^a-z0-9]/g, "_");
}

const initialGameState = (numPlayers, names, initialOrder, stakes) => ({
  numPlayers, names, initialOrder,
  currentHole: 1,
  points: Array(numPlayers).fill(0),
  carryover: 0,
  history: [],
  screen: "game",
  stakes,
});

export default function WolfTracker() {
  const [appScreen, setAppScreen] = useState("home");
  const [roomCode, setRoomCode] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [isScorekeeper, setIsScorekeeper] = useState(false);
  const [joinError, setJoinError] = useState("");
  const [gameState, setGameState] = useState(null);
  const [numPlayers, setNumPlayers] = useState(4);
  const [selectedPlayers, setSelectedPlayers] = useState([]);
  const [initialOrder, setInitialOrder] = useState([0, 1, 2, 3]);
  const [stakes, setStakes] = useState(3);
  const [customStakes, setCustomStakes] = useState("");
  const [pendingOutcome, setPendingOutcome] = useState(null);
  const [pendingPartner, setPendingPartner] = useState(null);
  const [pendingTopScorers, setPendingTopScorers] = useState([]);
  const [allPlayers, setAllPlayers] = useState({});
  const [newPlayerName, setNewPlayerName] = useState("");
  const [statsSaved, setStatsSaved] = useState(false);
  const [modal, setModal] = useState(null); // null | "payout" | "rules"

  useEffect(() => {
    const unsub = onValue(ref(db, "players"), (snap) => setAllPlayers(snap.val() || {}));
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!roomCode) return;
    const unsub = onValue(ref(db, `rooms/${roomCode}`), (snap) => {
      const data = snap.val();
      if (data) setGameState(data);
    });
    return () => unsub();
  }, [roomCode]);

  function pushState(newState) { set(ref(db, `rooms/${roomCode}`), newState); }
  function deleteRoom() { if (roomCode) remove(ref(db, `rooms/${roomCode}`)); }

  async function saveRoundStats(finalPoints, names) {
    const maxPts = Math.max(...finalPoints);
    const updates = {};
    for (let i = 0; i < names.length; i++) {
      const key = sanitizeKey(names[i]);
      const existing = allPlayers[key] || { name: names[i], totalPoints: 0, roundsPlayed: 0, wins: 0 };
      updates[`players/${key}`] = {
        name: names[i],
        totalPoints: (existing.totalPoints || 0) + finalPoints[i],
        roundsPlayed: (existing.roundsPlayed || 0) + 1,
        wins: (existing.wins || 0) + (finalPoints[i] === maxPts ? 1 : 0),
      };
    }
    await update(ref(db), updates);
  }

  const gs = gameState;
  const order = gs ? getOrder(gs.initialOrder, gs.currentHole, gs.numPlayers) : [];
  const wolfIndex = gs ? order[gs.numPlayers - 1] : null;
  const nonWolves = gs ? order.slice(0, gs.numPlayers - 1) : [];
  const carryover = gs?.carryover || 0;

  function getSplitInfo(o, partner) {
    if (!o || o.tie || !gs) return null;
    const total = o.basePoints + carryover;
    let recipients = [];
    if (o.loss) {
      recipients = o.partnerMode && partner !== null
        ? order.slice(0, gs.numPlayers - 1).filter(i => i !== partner)
        : [...order.slice(0, gs.numPlayers - 1)];
    } else {
      if (o.partnerMode && partner !== null) recipients = [wolfIndex, partner];
      else return null;
    }
    const n = recipients.length;
    return { total, recipients, base: Math.floor(total / n), remainder: total % n };
  }

  function handleCreateRoom() {
    const code = generateRoomCode();
    setRoomCode(code);
    setIsScorekeeper(true);
    setStatsSaved(false);
    setAppScreen("setup");
  }

  async function handleJoinRoom() {
    setJoinError("");
    const code = joinCode.trim();
    if (code.length !== 4) { setJoinError("Enter a 4-digit code"); return; }
    const snapshot = await get(ref(db, `rooms/${code}`));
    if (!snapshot.exists()) { setJoinError("Room not found — check the code!"); return; }
    setRoomCode(code);
    setIsScorekeeper(false);
    setAppScreen("spectate");
  }

  function changeNumPlayers(n) {
    setNumPlayers(n);
    setSelectedPlayers([]);
    setInitialOrder(Array.from({ length: n }, (_, i) => i));
  }

  function togglePlayerSelection(key) {
    if (selectedPlayers.includes(key)) setSelectedPlayers(selectedPlayers.filter(k => k !== key));
    else if (selectedPlayers.length < numPlayers) setSelectedPlayers([...selectedPlayers, key]);
  }

  function randomizeOrder() {
    const arr = Array.from({ length: numPlayers }, (_, i) => i);
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    setInitialOrder(arr);
  }

  function startGame() {
    if (selectedPlayers.length !== numPlayers) return;
    const names = selectedPlayers.map(key => allPlayers[key]?.name || key);
    pushState(initialGameState(numPlayers, names, initialOrder, stakes));
  }

  function addNewPlayer() {
    if (!newPlayerName.trim()) return;
    const key = sanitizeKey(newPlayerName);
    if (allPlayers[key]) return;
    set(ref(db, `players/${key}`), { name: newPlayerName.trim(), totalPoints: 0, roundsPlayed: 0, wins: 0 });
    setNewPlayerName("");
  }

  function removePlayer(key) {
    if (window.confirm(`Remove ${allPlayers[key]?.name}? This will delete all their stats.`))
      remove(ref(db, `players/${key}`));
  }

  function recordHole() {
    if (!pendingOutcome || !gs) return;
    const o = pendingOutcome;
    const totalPoints = o.basePoints + carryover;
    const newPoints = [...gs.points];
    const split = getSplitInfo(o, pendingPartner);
    let delta = Array(gs.numPlayers).fill(0);

    if (o.tie) {
      pushState({
        ...gs, carryover: totalPoints,
        history: [...(gs.history||[]), { hole: gs.currentHole, wolf: wolfIndex, outcome: o.label, partner: null, pointsAtStake: totalPoints, carried: totalPoints, delta }],
        currentHole: gs.currentHole === TOTAL_HOLES ? gs.currentHole : gs.currentHole + 1,
        screen: gs.currentHole === TOTAL_HOLES ? "summary" : "game",
      });
    } else {
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
      const outcomeLabel = o.partnerMode && pendingPartner !== null
        ? o.label.replace("Partner", gs.names[pendingPartner]) : o.label;
      pushState({
        ...gs, points: newPoints, carryover: 0,
        history: [...(gs.history||[]), { hole: gs.currentHole, wolf: wolfIndex, outcome: outcomeLabel, partner: o.partnerMode ? pendingPartner : null, pointsAtStake: totalPoints, carried: 0, delta }],
        currentHole: gs.currentHole === TOTAL_HOLES ? gs.currentHole : gs.currentHole + 1,
        screen: gs.currentHole === TOTAL_HOLES ? "summary" : "game",
      });
    }
    setPendingOutcome(null); setPendingPartner(null); setPendingTopScorers([]);
  }

  function undoLastHole() {
    if (!gs?.history?.length) return;
    const last = gs.history[gs.history.length - 1];
    const prevEntry = gs.history.length > 1 ? gs.history[gs.history.length - 2] : null;
    pushState({
      ...gs,
      points: gs.points.map((p, i) => p - last.delta[i]),
      currentHole: last.hole,
      carryover: prevEntry?.carried || 0,
      history: gs.history.slice(0, -1),
      screen: "game",
    });
    setPendingOutcome(null); setPendingPartner(null); setPendingTopScorers([]);
  }

  function resetAll() {
    deleteRoom();
    setAppScreen("home"); setRoomCode(""); setJoinCode(""); setGameState(null);
    setIsScorekeeper(false); setSelectedPlayers([]); setStatsSaved(false);
    setPendingOutcome(null); setPendingPartner(null); setPendingTopScorers([]);
  }

  const sortedPlayers = gs
    ? [...gs.points.map((p, i) => ({ i, name: gs.names[i], pts: p }))].sort((a, b) => b.pts - a.pts)
    : [];

  const holeValue = pendingOutcome ? pendingOutcome.basePoints + carryover : null;

  const leaderboardPlayers = Object.entries(allPlayers)
    .map(([key, p]) => ({ key, ...p, avg: p.roundsPlayed > 0 ? (p.totalPoints / p.roundsPlayed).toFixed(1) : "0.0" }))
    .sort((a, b) => b.wins - a.wins || b.totalPoints - a.totalPoints);

  // ---- MODAL ----
  const Modal = ({ type, onClose }) => {
    const content = type === "rules" ? {
      title: "🐺 How to Play",
      body: [
        { heading: "Setup", text: "4 players are randomly ordered 1–4. The player in position 4 is the Wolf." },
        { heading: "The Wolf's Options", text: "After each player tees off, the Wolf decides to pick them as a partner or pass. Once you pass, they're gone. If the Wolf passes on everyone they go Solo." },
        { heading: "Straddle", text: "The Wolf can declare a Straddle before anyone tees off — going it alone blind for higher stakes." },
        { heading: "Points", text: "Partner Win/Loss: 2pts · Solo Win/Loss: 3pts · Straddle Win/Loss: 4pts" },
        { heading: "Carryover", text: "If there's a tie, the points from that hole carry over and stack onto the next hole." },
        { heading: "Rotation", text: "After each hole the order rotates so everyone gets to be the Wolf." },
      ]
    } : {
      title: "💸 How Payouts Work",
      body: [
        { heading: "Even Split Baseline", text: "At the end of the round we find the average points scored. Players above average collect, players below average pay." },
        { heading: "Example", text: "If the average is 20pts and you scored 24pts, you're +4. At $3/pt that's +$12. If you scored 16pts you're -4, so you owe $12." },
        { heading: "Minimum Transactions", text: "We settle with as few payments as possible. The biggest winner collects from the biggest loser first, then repeat until everyone is zeroed out." },
        { heading: "Stakes", text: "You set the $ per point at the start of each round. $3/pt is standard and usually results in $5–$15 swings." },
      ]
    };
    return (
      <div style={S.modalOverlay} onClick={onClose}>
        <div style={S.modalCard} onClick={e => e.stopPropagation()}>
          <div style={S.modalHeader}>
            <h2 style={S.modalTitle}>{content.title}</h2>
            <button style={S.modalClose} onClick={onClose}>✕</button>
          </div>
          <div style={S.divider} />
          {content.body.map((item, i) => (
            <div key={i} style={S.modalSection}>
              <p style={S.modalHeading}>{item.heading}</p>
              <p style={S.modalText}>{item.text}</p>
            </div>
          ))}
        </div>
      </div>
    );
  };

  // ---- HOME ----
  if (appScreen === "home") return (
    <div style={S.page}>
      {modal && <Modal type={modal} onClose={() => setModal(null)} />}
      <div style={S.card}>
      <div style={S.logo}>🐺</div>
      <h1 style={S.title}>The Wolf</h1>
      <p style={S.subtitle}>Golf Point Tracker</p>
      <div style={S.homeInfoButtons}>
        <button style={S.infoBtn} onClick={() => setModal("rules")}>📋 Rules</button>
        <button style={S.infoBtn} onClick={() => setModal("payout")}>💸 Payouts</button>
      </div>
      <div style={S.divider} />
      <button style={S.primaryBtn} onClick={handleCreateRoom}>🏌️ Create New Room</button>
      <div style={S.orDivider}><span>or</span></div>
      <p style={S.label}>Join a room</p>
      <input style={{...S.input, textAlign:"center", fontSize:22, letterSpacing:6, fontWeight:"bold", marginBottom:8}}
        placeholder="0000" maxLength={4} value={joinCode}
        onChange={e => setJoinCode(e.target.value.replace(/\D/g, ""))} />
      {joinError && <p style={S.errorText}>{joinError}</p>}
      <button style={{...S.secondaryBtn, opacity: joinCode.length!==4?0.4:1}} disabled={joinCode.length!==4} onClick={handleJoinRoom}>
        Join Room →
      </button>
      <div style={S.divider} />
      <div style={S.homeButtons}>
        <button style={S.homeIconBtn} onClick={() => setAppScreen("leaderboard")}>
          <span style={S.homeIconEmoji}>🏆</span><span style={S.homeIconLabel}>Leaderboard</span>
        </button>
        <button style={S.homeIconBtn} onClick={() => setAppScreen("players")}>
          <span style={S.homeIconEmoji}>👥</span><span style={S.homeIconLabel}>Players</span>
        </button>
      </div>
      </div>
    </div>
  );
  if (appScreen === "leaderboard") return (
    <div style={S.page}><div style={S.card}>
      <div style={S.screenHeader}>
        <button style={S.backBtn} onClick={() => setAppScreen("home")}>← Back</button>
        <h2 style={S.screenTitle}>🏆 Leaderboard</h2>
      </div>
      <div style={S.divider} />
      {leaderboardPlayers.length === 0
        ? <p style={S.emptyText}>No players yet — add some in the Players screen!</p>
        : <>
          <div style={S.lbHeader}>
            <span style={{width:28}} />
            <span style={{flex:2, fontFamily:"sans-serif", fontSize:11}}>PLAYER</span>
            <span style={S.lbCol}>WINS</span>
            <span style={S.lbCol}>PTS</span>
            <span style={S.lbCol}>AVG</span>
            <span style={S.lbCol}>RDS</span>
          </div>
          {leaderboardPlayers.map((p, rank) => (
            <div key={p.key} style={{...S.lbRow, background: rank===0?"#f0f9eb":rank%2===0?"#fafafa":"#fff"}}>
              <span style={S.lbRank}>{rank===0?"🥇":rank===1?"🥈":rank===2?"🥉":`${rank+1}.`}</span>
              <span style={{flex:2, fontFamily:"sans-serif", fontSize:14, fontWeight:"bold"}}>{p.name}</span>
              <span style={S.lbCol}>{p.wins}</span>
              <span style={S.lbCol}>{p.totalPoints}</span>
              <span style={S.lbCol}>{p.avg}</span>
              <span style={S.lbCol}>{p.roundsPlayed}</span>
            </div>
          ))}
          <div style={S.lbLegend}>
            WINS = Most pts in a round · PTS = Total Points{"\n"}AVG = Points per Round · RDS = Rounds Played
          </div>
        </>
      }
    </div></div>
  );

  // ---- MANAGE PLAYERS ----
  if (appScreen === "players") return (
    <div style={S.page}><div style={S.card}>
      <div style={S.screenHeader}>
        <button style={S.backBtn} onClick={() => setAppScreen("home")}>← Back</button>
        <h2 style={S.screenTitle}>👥 Players</h2>
      </div>
      <div style={S.divider} />
      <p style={S.label}>Add New Player</p>
      <div style={S.addPlayerRow}>
        <input style={{...S.input, flex:1}} placeholder="Player name" value={newPlayerName}
          onChange={e => setNewPlayerName(e.target.value)}
          onKeyDown={e => e.key === "Enter" && addNewPlayer()} />
        <button style={S.addBtn} onClick={addNewPlayer}>Add</button>
      </div>
      <div style={S.divider} />
      <p style={S.label}>All Players</p>
      {Object.keys(allPlayers).length === 0
        ? <p style={S.emptyText}>No players yet!</p>
        : Object.entries(allPlayers).map(([key, p]) => (
          <div key={key} style={S.playerRow}>
            <span style={S.playerRowName}>{p.name}</span>
            <span style={S.playerRowStats}>{p.totalPoints} pts · {p.roundsPlayed} rds · {p.wins} wins</span>
            <button style={S.removeBtn} onClick={() => removePlayer(key)}>✕</button>
          </div>
        ))
      }
    </div></div>
  );

  // ---- SETUP ----
  if (appScreen === "setup" && (!gs || (gs.screen !== "game" && gs.screen !== "summary"))) {
    const playerKeys = Object.keys(allPlayers);
    return (
      <div style={S.page}><div style={S.card}>
        <div style={S.logo}>🐺</div>
        <h1 style={S.title}>The Wolf</h1>
        <div style={S.roomCodeBadge}>Room: <strong>{roomCode}</strong></div>
        <p style={S.roomHint}>Share this code so friends can follow along!</p>
        <div style={S.divider} />
        <p style={S.label}>Stakes ($ per point)</p>
        <div style={S.stakesGrid}>
          {[1, 3, 5].map(n => (
            <button key={n}
              style={{...S.countBtn, ...(stakes===n && customStakes===""?S.countBtnActive:{})}}
              onClick={() => { setStakes(n); setCustomStakes(""); }}
            >${n}/pt</button>
          ))}
          <div style={{...S.countBtn, ...(customStakes!==""?S.countBtnActive:{}), display:"flex", alignItems:"center", padding:"6px 10px", gap:4}}>
            <span style={{fontSize:13, color: customStakes!==""?"#fff":"#555"}}>$</span>
            <input
              style={{width:"100%", border:"none", background:"transparent", fontSize:14, outline:"none", color: customStakes!==""?"#fff":"#111", fontFamily:"sans-serif"}}
              placeholder="Custom"
              value={customStakes}
              onChange={e => {
                const val = e.target.value.replace(/[^0-9.]/g, "");
                setCustomStakes(val);
                if (val) setStakes(parseFloat(val));
              }}
            />
          </div>
        </div>
        <div style={S.playerCountGrid}>
          {[3,4].map(n => (
            <button key={n} style={{...S.countBtn, ...(numPlayers===n?S.countBtnActive:{})}} onClick={() => changeNumPlayers(n)}>
              {n} Players
            </button>
          ))}
        </div>
        <p style={S.label}>Select {numPlayers} Players ({selectedPlayers.length}/{numPlayers})</p>
        {playerKeys.length === 0
          ? <p style={S.emptyText}>No players saved yet — add one below!</p>
          : <div style={S.playerSelectGrid}>
            {playerKeys.map(key => {
              const selected = selectedPlayers.includes(key);
              const disabled = !selected && selectedPlayers.length >= numPlayers;
              return (
                <button key={key}
                  style={{...S.playerSelectBtn, ...(selected?S.playerSelectBtnActive:{}), opacity:disabled?0.4:1}}
                  onClick={() => !disabled && togglePlayerSelection(key)}
                >{allPlayers[key].name}</button>
              );
            })}
          </div>
        }
        <div style={S.addInlineRow}>
          <input style={{...S.input, flex:1, fontSize:13, padding:"8px 12px"}}
            placeholder="+ Add new player"
            value={newPlayerName}
            onChange={e => setNewPlayerName(e.target.value)}
            onKeyDown={e => e.key === "Enter" && addNewPlayer()}
          />
          <button style={S.addBtn} onClick={addNewPlayer}>Add</button>
        </div>
        {selectedPlayers.length === numPlayers && <>
          <div style={S.divider} />
          <p style={S.label}>Tee Order</p>
          <div style={S.teeOrder}>
            {initialOrder.map((playerIdx, pos) => (
              <div key={playerIdx} style={{...S.teeSlot, background: pos===numPlayers-1?"#1a1a1a":"#f5f5f5"}}>
                <span style={{...S.teePos, color: pos===numPlayers-1?"#c8f56a":"#999"}}>{pos+1}</span>
                <span style={{...S.teeName, color: pos===numPlayers-1?"#fff":"#111"}}>
                  {allPlayers[selectedPlayers[playerIdx]]?.name || `P${playerIdx+1}`}
                </span>
              </div>
            ))}
          </div>
          <button style={S.secondaryBtn} onClick={randomizeOrder}>🔀 Randomize Tee Order</button>
        </>}
        <button style={{...S.primaryBtn, marginTop:8, opacity:selectedPlayers.length!==numPlayers?0.4:1}}
          disabled={selectedPlayers.length!==numPlayers} onClick={startGame}>
          Start Round
        </button>
      </div></div>
    );
  }

  // ---- WAITING ----
  if (appScreen === "spectate" && !gs) return (
    <div style={S.page}><div style={S.card}>
      <div style={S.logo}>🐺</div>
      <h1 style={S.title}>The Wolf</h1>
      <div style={S.roomCodeBadge}>Room: <strong>{roomCode}</strong></div>
      <div style={S.divider} />
      <p style={{textAlign:"center", fontFamily:"sans-serif", color:"#666"}}>⏳ Waiting for the round to start...</p>
    </div></div>
  );

  // ---- SUMMARY ----
  if (gs?.screen === "summary") {
    const totalPts = gs.points.reduce((a,b)=>a+b,0);
    const avg = totalPts / gs.numPlayers;
    const multiplier = gs.stakes || 1;
    const netDollars = gs.points.map((p,i) => ({ i, name: gs.names[i], net: (p - avg) * multiplier }));
    const settlements = [];
    const balances = netDollars.map(p => ({...p}));
    for (let r = 0; r < gs.numPlayers*3; r++) {
      const payers = balances.filter(p=>p.net<-0.001).sort((a,b)=>a.net-b.net);
      const collectors = balances.filter(p=>p.net>0.001).sort((a,b)=>b.net-a.net);
      if (!payers.length || !collectors.length) break;
      const amount = Math.min(Math.abs(payers[0].net), collectors[0].net);
      settlements.push({ from: payers[0].name, to: collectors[0].name, amount });
      payers[0].net += amount; collectors[0].net -= amount;
    }
    return (
      <div style={S.page}><div style={S.card}>
        <div style={S.logo}>🏆</div>
        <h1 style={S.title}>Round Over</h1>
        <div style={S.roomCodeBadge}>Room: <strong>{roomCode}</strong></div>
        <p style={{textAlign:"center", fontFamily:"sans-serif", fontSize:12, color:"#999", margin:"4px 0 0"}}>
          Stakes: ${gs.stakes || 1}/pt
        </p>
        <div style={S.divider} />
        {sortedPlayers.map((p, rank) => {
          const net = netDollars.find(n=>n.i===p.i).net;
          return (
            <div key={p.i} style={{...S.leaderRow, background:rank===0?"#f0f9eb":"#fafafa"}}>
              <span style={S.rank}>{rank===0?"🥇":rank===1?"🥈":rank===2?"🥉":"4th"}</span>
              <span style={S.leaderName}>{p.name}</span>
              <span style={S.leaderPts}>{p.pts} pts</span>
              <span style={{...S.leaderNet, color:net>=0?"#2a9d2a":"#cc0000"}}>
                {net>=0?`+$${net.toFixed(2)}`:`-$${Math.abs(net).toFixed(2)}`}
              </span>
            </div>
          );
        })}
        <div style={S.divider} />
        <p style={S.sectionLabel}>💸 PAYOUTS</p>
        {settlements.length===0
          ? <p style={{fontFamily:"sans-serif", fontSize:13, color:"#999", textAlign:"center"}}>Everyone is even!</p>
          : settlements.map((s,i) => (
            <div key={i} style={S.payoutRow}>
              <span style={S.payoutFrom}>{s.from}</span>
              <span style={S.payoutArrow}>owes</span>
              <span style={S.payoutTo}>{s.to}</span>
              <span style={S.payoutAmount}>${s.amount.toFixed(2)}</span>
            </div>
          ))
        }
        {!statsSaved
          ? <button style={{...S.primaryBtn, marginTop:16, background:"#2a9d2a"}} onClick={async () => {
              await saveRoundStats(gs.points, gs.names);
              setStatsSaved(true);
            }}>💾 Save Round Stats</button>
          : <div style={S.savedBanner}>✅ Stats saved to leaderboard!</div>
        }
        <div style={S.divider} />
        <p style={S.sectionLabel}>HOLE-BY-HOLE</p>
        <div style={S.historyList}>
          {(gs.history||[]).map((h,i) => (
            <div key={i} style={S.historyRow}>
              <span style={S.historyHole}>H{h.hole}</span>
              <span style={S.historyWolf}>🐺 {gs.names[h.wolf]}</span>
              <span style={S.historyOutcome}>{h.outcome}</span>
              <span style={{...S.historyPts, color:h.carried>0?"#f0a500":"#2a9d2a"}}>
                {h.carried>0?`+${h.carried} carry`:`${h.pointsAtStake}pts`}
              </span>
            </div>
          ))}
        </div>
        <button style={{...S.primaryBtn, marginTop:16}} onClick={resetAll}>New Round</button>
      </div></div>
    );
  }

  // ---- GAME ----
  if (!gs) return null;
  return (
    <div style={S.page}><div style={S.card}>
      <div style={S.holeHeader}>
        <div>
          <span style={S.holeLabel}>HOLE</span>
          <span style={S.holeNum}>{gs.currentHole}</span>
          <span style={S.holeOf}>/ {TOTAL_HOLES}</span>
        </div>
        <div style={{display:"flex", alignItems:"center", gap:8}}>
          {gs.history?.length > 0 && <button style={S.undoBtn} onClick={undoLastHole}>← Undo</button>}
          <div style={S.wolfBadge}>🐺 {gs.names[wolfIndex]}</div>
        </div>
      </div>

      <div style={S.roomCodeSmall}>
        Room: <strong>{roomCode}</strong>
      </div>

      {carryover > 0 && <div style={S.carryBanner}>🔥 {carryover} pts carrying in from previous hole{carryover>2?"s":""}</div>}

      <div style={S.section}>
        <p style={S.sectionLabel}>TEE ORDER</p>
        <div style={S.teeOrder}>
          {order.map((playerIdx, pos) => (
            <div key={playerIdx} style={{...S.teeSlot, background:pos===gs.numPlayers-1?"#1a1a1a":"#f5f5f5"}}>
              <span style={{...S.teePos, color:pos===gs.numPlayers-1?"#c8f56a":"#999"}}>{pos+1}</span>
              <span style={{...S.teeName, color:pos===gs.numPlayers-1?"#fff":"#111"}}>{gs.names[playerIdx]}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={S.section}>
        <p style={S.sectionLabel}>POINTS</p>
        <div style={S.scoreGrid}>
          {sortedPlayers.map(p => (
            <div key={p.i} style={S.scoreItem}>
              <span style={S.scoreName}>{p.name}</span>
              <span style={S.scoreVal}>{p.pts}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={S.divider} />
      <p style={S.sectionLabel}>RECORD OUTCOME</p>

      <p style={S.groupLabel}>✅ Wolf Wins</p>
      <div style={S.outcomeGrid}>
        {OUTCOME_TYPES.filter(o=>!o.loss&&!o.tie).map((o,i) => {
          const val = o.basePoints + carryover;
          return (
            <button key={i} style={{...S.outcomeBtn,...(pendingOutcome?.id===o.id?S.outcomeBtnActive:{})}}
              onClick={() => { setPendingOutcome(o); setPendingPartner(null); setPendingTopScorers([]); }}>
              <span>{o.label}</span><span style={S.outcomePts}>{val} pt{val!==1?"s":""}</span>
            </button>
          );
        })}
      </div>

      <p style={S.groupLabel}>❌ Wolf Lost</p>
      <div style={S.outcomeGrid}>
        {OUTCOME_TYPES.filter(o=>o.loss).map((o,i) => {
          const val = o.basePoints + carryover;
          return (
            <button key={i} style={{...S.outcomeBtn,...(pendingOutcome?.id===o.id?S.outcomeBtnLoss:{})}}
              onClick={() => { setPendingOutcome(o); setPendingPartner(null); setPendingTopScorers([]); }}>
              <span>{o.label}</span><span style={S.outcomePts}>{val} pt{val!==1?"s":""} to others</span>
            </button>
          );
        })}
      </div>

      <p style={S.groupLabel}>😬 Tie — Carry Over</p>
      <div style={S.outcomeGrid}>
        {OUTCOME_TYPES.filter(o=>o.tie).map((o,i) => (
          <button key={i} style={{...S.outcomeBtn,...(pendingOutcome?.id===o.id?S.outcomeBtnTie:{})}}
            onClick={() => { setPendingOutcome(o); setPendingPartner(null); setPendingTopScorers([]); }}>
            <span>{o.label}</span><span style={S.outcomePts}>{o.basePoints} pts carry →</span>
          </button>
        ))}
      </div>

      {pendingOutcome?.partnerMode && !pendingOutcome.tie && (
        <div style={S.section}>
          <p style={S.sectionLabel}>SELECT PARTNER</p>
          <div style={S.partnerGrid}>
            {nonWolves.map(pi => (
              <button key={pi} style={{...S.partnerBtn,...(pendingPartner===pi?S.partnerBtnActive:{})}}
                onClick={() => { setPendingPartner(pi); setPendingTopScorers([]); }}>
                {gs.names[pi]}
              </button>
            ))}
          </div>
        </div>
      )}

      {(() => {
        const split = getSplitInfo(pendingOutcome, pendingPartner);
        if (!split || split.remainder===0) return null;
        if (pendingOutcome?.partnerMode && pendingPartner===null) return null;
        const needed = split.remainder;
        return (
          <div style={S.section}>
            <div style={S.oddBanner}>
              ⚡ {split.total} pts ÷ {split.recipients.length} players — {needed} extra pt{needed>1?"s":""}! Select the {needed===1?"best scorer":`best ${needed} scorers`}:
            </div>
            <div style={S.partnerGrid}>
              {split.recipients.map(pi => {
                const selected = pendingTopScorers.includes(pi);
                return (
                  <button key={pi} style={{...S.partnerBtn,...(selected?S.partnerBtnActive:{})}}
                    onClick={() => {
                      if (selected) setPendingTopScorers(pendingTopScorers.filter(x=>x!==pi));
                      else if (pendingTopScorers.length < needed) setPendingTopScorers([...pendingTopScorers, pi]);
                    }}>
                    {gs.names[pi]}<span style={{fontSize:11,opacity:0.7,marginLeft:4}}>+{split.base+(selected?1:0)}</span>
                  </button>
                );
              })}
            </div>
            <p style={{fontSize:11,color:"#aaa",fontFamily:"sans-serif",margin:"4px 0 0",textAlign:"center"}}>
              {pendingTopScorers.length}/{needed} selected
            </p>
          </div>
        );
      })()}

      {pendingOutcome && (
        <div style={S.stakeRow}>
          <span style={S.stakeLabel}>Points at stake this hole:</span>
          <span style={S.stakeVal}>{holeValue}</span>
        </div>
      )}

      <button
        style={{...S.primaryBtn, marginTop:12, opacity:(() => {
          if (!pendingOutcome) return 0.35;
          if (pendingOutcome.partnerMode && !pendingOutcome.tie && pendingPartner===null) return 0.35;
          const split = getSplitInfo(pendingOutcome, pendingPartner);
          if (split && split.remainder>0 && pendingTopScorers.length<split.remainder) return 0.35;
          return 1;
        })()}}
        disabled={(() => {
          if (!pendingOutcome) return true;
          if (pendingOutcome.partnerMode && !pendingOutcome.tie && pendingPartner===null) return true;
          const split = getSplitInfo(pendingOutcome, pendingPartner);
          if (split && split.remainder>0 && pendingTopScorers.length<split.remainder) return true;
          return false;
        })()}
        onClick={recordHole}
      >
        {pendingOutcome?.tie
          ? `Carry ${holeValue} pts to Hole ${gs.currentHole+1} →`
          : gs.currentHole===TOTAL_HOLES ? "Finish Round →" : `Next Hole (${gs.currentHole+1}) →`}
      </button>
    </div></div>
  );
}

const S = {
  page: { minHeight:"100vh", background:"#f2f2ef", display:"flex", alignItems:"flex-start", justifyContent:"center", padding:"24px 16px", fontFamily:"'Georgia', serif" },
  card: { background:"#fff", borderRadius:16, padding:"28px 24px", width:"100%", maxWidth:420, boxShadow:"0 2px 20px rgba(0,0,0,0.08)" },
  logo: { textAlign:"center", fontSize:40, marginBottom:4 },
  title: { textAlign:"center", fontSize:28, fontWeight:"bold", margin:0, letterSpacing:-1, color:"#111" },
  subtitle: { textAlign:"center", color:"#888", fontSize:14, margin:"4px 0 0", fontFamily:"sans-serif" },
  divider: { height:1, background:"#eee", margin:"20px 0" },
  label: { fontSize:11, fontWeight:"bold", color:"#555", letterSpacing:1, textTransform:"uppercase", fontFamily:"sans-serif", marginBottom:10, marginTop:0 },
  input: { padding:"10px 14px", border:"1.5px solid #e0e0e0", borderRadius:8, fontSize:15, fontFamily:"sans-serif", outline:"none", width:"100%", boxSizing:"border-box" },
  secondaryBtn: { width:"100%", padding:"10px", border:"1.5px solid #ddd", borderRadius:8, background:"#fafafa", fontSize:14, cursor:"pointer", fontFamily:"sans-serif", marginBottom:8 },
  primaryBtn: { width:"100%", padding:"14px", background:"#111", color:"#fff", border:"none", borderRadius:10, fontSize:15, cursor:"pointer", fontFamily:"sans-serif", fontWeight:"bold", transition:"opacity 0.2s" },
  orDivider: { textAlign:"center", color:"#bbb", fontFamily:"sans-serif", fontSize:13, margin:"12px 0" },
  errorText: { color:"#c00", fontSize:13, fontFamily:"sans-serif", textAlign:"center", margin:"4px 0" },
  homeButtons: { display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 },
  homeIconBtn: { padding:"16px 8px", border:"1.5px solid #e0e0e0", borderRadius:12, background:"#fff", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:6 },
  homeIconEmoji: { fontSize:28 },
  homeIconLabel: { fontSize:13, fontFamily:"sans-serif", color:"#444" },
  screenHeader: { display:"flex", alignItems:"center", gap:12, marginBottom:4 },
  backBtn: { padding:"6px 12px", border:"1.5px solid #ddd", borderRadius:20, background:"#fff", fontSize:13, cursor:"pointer", fontFamily:"sans-serif", color:"#555", flexShrink:0 },
  screenTitle: { fontSize:20, fontWeight:"bold", margin:0, color:"#111" },
  emptyText: { textAlign:"center", color:"#aaa", fontFamily:"sans-serif", fontSize:14 },
  lbHeader: { display:"flex", alignItems:"center", padding:"8px 10px", fontSize:11, fontWeight:"bold", color:"#999", fontFamily:"sans-serif", letterSpacing:1, textTransform:"uppercase", marginBottom:4, borderBottom:"1px solid #eee" },
  lbRow: { display:"flex", alignItems:"center", padding:"12px 10px", borderRadius:8, marginBottom:4 },
  lbRank: { width:32, fontSize:14, flexShrink:0 },
  lbCol: { width:44, textAlign:"right", fontFamily:"sans-serif", fontSize:13, color:"#444", flexShrink:0 },
  lbLegend: { fontSize:10, color:"#bbb", fontFamily:"sans-serif", textAlign:"center", marginTop:12, lineHeight:2 },
  addInlineRow: { display:"flex", gap:8, marginTop:8, marginBottom:8 },
  addBtn: { padding:"10px 16px", background:"#111", color:"#fff", border:"none", borderRadius:8, fontSize:14, cursor:"pointer", fontFamily:"sans-serif", flexShrink:0 },
  playerRow: { display:"flex", alignItems:"center", padding:"10px 12px", background:"#fafafa", borderRadius:8, marginBottom:6 },
  playerRowName: { flex:1, fontFamily:"sans-serif", fontSize:14, fontWeight:"bold" },
  playerRowStats: { fontSize:11, color:"#999", fontFamily:"sans-serif", marginRight:8 },
  removeBtn: { background:"none", border:"none", color:"#cc0000", fontSize:16, cursor:"pointer", padding:"0 4px" },
  roomCodeBadge: { textAlign:"center", background:"#1a1a1a", color:"#c8f56a", borderRadius:20, padding:"6px 16px", fontSize:16, fontFamily:"sans-serif", margin:"8px auto", display:"block" },
  roomCodeSmall: { fontSize:12, fontFamily:"sans-serif", color:"#888", textAlign:"center", marginBottom:10, display:"flex", alignItems:"center", justifyContent:"center", gap:8 },
  roomHint: { textAlign:"center", fontSize:12, color:"#999", fontFamily:"sans-serif", margin:"4px 0 0" },
  closeRoomBtn: { fontSize:11, fontFamily:"sans-serif", color:"#cc0000", background:"none", border:"1px solid #cc0000", borderRadius:10, padding:"2px 8px", cursor:"pointer" },
  playerCountGrid: { display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:16 },
  stakesGrid: { display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:8, marginBottom:16 },
  countBtn: { padding:"10px", border:"1.5px solid #e0e0e0", borderRadius:8, background:"#fff", fontSize:14, cursor:"pointer", fontFamily:"sans-serif" },
  countBtnActive: { border:"1.5px solid #111", background:"#111", color:"#fff" },
  playerSelectGrid: { display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:8 },
  playerSelectBtn: { padding:"12px 8px", border:"1.5px solid #e0e0e0", borderRadius:8, background:"#fff", fontSize:14, cursor:"pointer", fontFamily:"sans-serif" },
  playerSelectBtnActive: { border:"1.5px solid #111", background:"#111", color:"#fff" },
  holeHeader: { display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 },
  holeLabel: { fontSize:11, color:"#999", fontFamily:"sans-serif", letterSpacing:2, display:"block" },
  holeNum: { fontSize:36, fontWeight:"bold", color:"#111", lineHeight:1 },
  holeOf: { fontSize:16, color:"#bbb", marginLeft:4 },
  wolfBadge: { background:"#1a1a1a", color:"#c8f56a", padding:"6px 12px", borderRadius:20, fontSize:13, fontFamily:"sans-serif" },
  undoBtn: { padding:"6px 12px", border:"1.5px solid #ddd", borderRadius:20, background:"#fff", fontSize:13, cursor:"pointer", fontFamily:"sans-serif", color:"#555" },
  section: { marginBottom:16 },
  sectionLabel: { fontSize:11, letterSpacing:2, color:"#999", textTransform:"uppercase", fontFamily:"sans-serif", marginBottom:8, marginTop:0 },
  teeOrder: { display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:8 },
  teeSlot: { borderRadius:8, padding:"10px 12px", display:"flex", alignItems:"center", gap:8 },
  teePos: { fontSize:11, fontWeight:"bold", fontFamily:"sans-serif", letterSpacing:1 },
  teeName: { fontSize:14, fontFamily:"sans-serif" },
  scoreGrid: { display:"grid", gridTemplateColumns:"1fr 1fr", gap:6 },
  scoreItem: { background:"#f9f9f9", borderRadius:8, padding:"8px 12px", display:"flex", justifyContent:"space-between", alignItems:"center" },
  scoreName: { fontSize:13, fontFamily:"sans-serif", color:"#444" },
  scoreVal: { fontSize:18, fontWeight:"bold", color:"#111" },
  outcomeGrid: { display:"flex", flexDirection:"column", gap:7, marginBottom:8 },
  outcomeBtn: { padding:"10px 14px", border:"1.5px solid #e0e0e0", borderRadius:8, background:"#fff", fontSize:14, cursor:"pointer", textAlign:"left", fontFamily:"sans-serif", transition:"all 0.15s", display:"flex", justifyContent:"space-between", alignItems:"center" },
  outcomeBtnActive: { border:"1.5px solid #111", background:"#111", color:"#fff" },
  outcomeBtnTie: { border:"1.5px solid #f0a500", background:"#fff8e6", color:"#7a5a00" },
  outcomeBtnLoss: { border:"1.5px solid #d00", background:"#fff0f0", color:"#900" },
  outcomePts: { fontSize:12, color:"#888", marginLeft:6, fontFamily:"sans-serif" },
  partnerGrid: { display:"flex", gap:8, flexWrap:"wrap" },
  partnerBtn: { flex:1, padding:"10px", border:"1.5px solid #e0e0e0", borderRadius:8, background:"#fff", fontSize:14, cursor:"pointer", fontFamily:"sans-serif" },
  partnerBtnActive: { border:"1.5px solid #111", background:"#111", color:"#fff" },
  oddBanner: { background:"#f0f0ff", border:"1.5px solid #aab", borderRadius:8, padding:"8px 12px", fontSize:13, fontFamily:"sans-serif", color:"#334", marginBottom:8, textAlign:"center" },
  stakeRow: { display:"flex", justifyContent:"space-between", alignItems:"center", background:"#f5f5f5", borderRadius:8, padding:"8px 14px", marginTop:8 },
  stakeLabel: { fontSize:13, fontFamily:"sans-serif", color:"#555" },
  stakeVal: { fontSize:20, fontWeight:"bold", color:"#111" },
  carryBanner: { background:"#fff8e6", border:"1.5px solid #f0c040", borderRadius:8, padding:"8px 12px", fontSize:13, fontFamily:"sans-serif", color:"#7a5a00", marginBottom:12, textAlign:"center" },
  groupLabel: { fontSize:12, fontWeight:"bold", color:"#666", fontFamily:"sans-serif", margin:"10px 0 6px", letterSpacing:0.5 },
  leaderRow: { display:"flex", alignItems:"center", padding:"12px 14px", borderRadius:10, marginBottom:8 },
  rank: { fontSize:20, marginRight:12 },
  leaderName: { flex:1, fontSize:16, fontFamily:"sans-serif" },
  leaderPts: { fontSize:20, fontWeight:"bold", fontFamily:"sans-serif" },
  leaderNet: { fontSize:13, fontWeight:"bold", fontFamily:"sans-serif", marginLeft:8, minWidth:50, textAlign:"right" },
  payoutRow: { display:"flex", alignItems:"center", gap:8, padding:"10px 14px", background:"#fafafa", borderRadius:10, marginBottom:8 },
  payoutFrom: { fontWeight:"bold", fontFamily:"sans-serif", fontSize:14, color:"#cc0000", flex:1 },
  payoutArrow: { fontSize:12, color:"#999", fontFamily:"sans-serif" },
  payoutTo: { fontWeight:"bold", fontFamily:"sans-serif", fontSize:14, color:"#2a9d2a", flex:1, textAlign:"center" },
  payoutAmount: { fontWeight:"bold", fontFamily:"sans-serif", fontSize:18, color:"#111", minWidth:60, textAlign:"right" },
  historyList: { maxHeight:200, overflowY:"auto" },
  historyRow: { display:"flex", alignItems:"center", gap:8, padding:"5px 0", borderBottom:"1px solid #f0f0f0", fontSize:12, fontFamily:"sans-serif" },
  historyHole: { width:28, color:"#999", flexShrink:0 },
  historyWolf: { width:80, color:"#444", flexShrink:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" },
  historyOutcome: { flex:1, color:"#666" },
  historyPts: { fontWeight:"bold", flexShrink:0 },
  savedBanner: { background:"#f0f9eb", border:"1.5px solid #2a9d2a", borderRadius:8, padding:"10px", textAlign:"center", fontFamily:"sans-serif", fontSize:14, color:"#2a9d2a", marginTop:16 },
  homeInfoButtons: { display:"flex", gap:8, justifyContent:"center", margin:"8px 0 0" },
  infoBtn: { padding:"6px 14px", border:"1.5px solid #e0e0e0", borderRadius:20, background:"#fff", fontSize:13, cursor:"pointer", fontFamily:"sans-serif", color:"#555" },
  modalOverlay: { position:"fixed", top:0, left:0, right:0, bottom:0, background:"rgba(0,0,0,0.5)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:16 },
  modalCard: { background:"#fff", borderRadius:16, padding:"24px", width:"100%", maxWidth:400, maxHeight:"80vh", overflowY:"auto", boxShadow:"0 8px 40px rgba(0,0,0,0.2)" },
  modalHeader: { display:"flex", justifyContent:"space-between", alignItems:"center" },
  modalTitle: { fontSize:18, fontWeight:"bold", margin:0, color:"#111" },
  modalClose: { background:"none", border:"none", fontSize:18, cursor:"pointer", color:"#999", padding:"0 4px" },
  modalSection: { marginBottom:14 },
  modalHeading: { fontSize:13, fontWeight:"bold", color:"#111", fontFamily:"sans-serif", margin:"0 0 4px" },
  modalText: { fontSize:13, color:"#555", fontFamily:"sans-serif", margin:0, lineHeight:1.6 },
};
