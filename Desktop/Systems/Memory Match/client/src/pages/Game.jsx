import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { SYMBOLS } from '../symbols.js';
import { isMuted, play, setMuted } from '../sound.js';

const MISMATCH_DELAY = 850;

const fmt = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export default function Game() {
  const { refresh } = useAuth();
  const [difficulties, setDifficulties] = useState([]);
  const [game, setGame] = useState(null);
  const [faces, setFaces] = useState({}); // index -> symbol id currently face-up
  const [wrong, setWrong] = useState([]); // indices shaking after a mismatch
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [msLeft, setMsLeft] = useState(0);
  const [showResult, setShowResult] = useState(false);
  const [muted, setMutedState] = useState(isMuted());
  const syncRef = useRef({ at: 0, elapsed: 0 });
  const finalizing = useRef(false);

  const applyGame = useCallback((g, keepFaces = false) => {
    setGame(g);
    syncRef.current = { at: Date.now(), elapsed: g.elapsedMs };
    setMsLeft(g.timeLimit * 1000 - g.elapsedMs);
    if (!keepFaces) {
      const f = { ...g.revealed };
      if (g.pending) f[g.pending.index] = g.pending.symbol;
      setFaces(f);
    }
  }, []);

  // Initial load: difficulties + resume any running game
  useEffect(() => {
    (async () => {
      try {
        const [d, a] = await Promise.all([api('/game/difficulties'), api('/game/active')]);
        setDifficulties(d.items);
        if (a.game) applyGame(a.game);
      } catch (e) {
        setError(e.message);
      }
    })();
  }, [applyGame]);

  const over = game && game.status !== 'active';

  const finishUp = useCallback(
    (g) => {
      play(g.status === 'won' ? 'win' : 'lose');
      setTimeout(() => setShowResult(true), 900);
      refresh();
    },
    [refresh]
  );

  // Countdown, derived from the server's elapsed time at the last sync
  useEffect(() => {
    if (!game || game.status !== 'active') return;
    const id = setInterval(() => {
      const left = game.timeLimit * 1000 - (syncRef.current.elapsed + Date.now() - syncRef.current.at);
      setMsLeft(left);
      if (left <= 0 && !finalizing.current) {
        finalizing.current = true;
        // Server enforces the limit itself (with a small grace); ask it to settle the game
        setTimeout(async () => {
          try {
            const { game: g } = await api(`/game/${game.id}`);
            if (g.status === 'active') {
              finalizing.current = false;
            } else {
              applyGame(g);
              finishUp(g);
              finalizing.current = false;
            }
          } catch (e) {
            setError(e.message);
            finalizing.current = false;
          }
        }, 1700);
      }
    }, 250);
    return () => clearInterval(id);
  }, [game, applyGame, finishUp]);

  async function start(key) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const { game: g } = await api('/game/start', { method: 'POST', body: { difficulty: key } });
      finalizing.current = false;
      setShowResult(false);
      setWrong([]);
      applyGame(g);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function flip(i) {
    // Client-side guards for UX; the server re-validates everything.
    if (busy || !game || game.status !== 'active' || faces[i] !== undefined || game.matched[i]) return;
    setBusy(true);
    setError('');
    try {
      const r = await api(`/game/${game.id}/flip`, { method: 'POST', body: { index: i } });
      play('flip');
      if (r.expired) {
        applyGame(r.game);
        finishUp(r.game);
        return;
      }
      if (r.phase === 'first') {
        setFaces((f) => ({ ...f, [i]: r.symbol }));
        setGame((g) => ({ ...g, pending: { index: i, symbol: r.symbol } }));
        return;
      }
      // second card of the pair
      setFaces((f) => ({ ...f, [r.second.index]: r.second.symbol }));
      if (r.match) {
        setTimeout(() => play('match'), 250);
        applyGame(r.game, true);
        if (r.game.status !== 'active') {
          setFaces((f) => ({ ...f, ...r.game.revealed }));
          finishUp(r.game);
        }
      } else {
        setTimeout(() => play('wrong'), 250);
        await new Promise((res) => setTimeout(res, 500));
        setWrong([r.first.index, r.second.index]);
        await new Promise((res) => setTimeout(res, MISMATCH_DELAY - 500));
        setWrong([]);
        setFaces((f) => {
          const n = { ...f };
          delete n[r.first.index];
          delete n[r.second.index];
          return n;
        });
        applyGame(r.game, true);
      }
    } catch (e) {
      setError(e.message);
      // resync in case our view drifted from the server's
      try {
        const { game: g } = await api(`/game/${game.id}`);
        applyGame(g);
        if (g.status !== 'active') finishUp(g);
      } catch { /* ignore */ }
    } finally {
      setBusy(false);
    }
  }

  async function quit() {
    if (!game || !window.confirm('Quit this game? It will count as a loss.')) return;
    try {
      const { game: g } = await api(`/game/${game.id}/abandon`, { method: 'POST' });
      applyGame(g);
      refresh();
      setGame(null);
    } catch (e) {
      setError(e.message);
    }
  }

  const toggleMute = () => {
    setMuted(!muted);
    setMutedState(!muted);
  };

  // ---------- Difficulty picker ----------
  if (!game) {
    return (
      <section className="picker">
        <h1>Choose your challenge</h1>
        <p className="muted">Match every pair before the clock runs out.</p>
        {error && <div className="error">{error}</div>}
        <div className="diff-grid">
          {difficulties.map((d) => (
            <button key={d.key} className={`diff diff-${d.key}`} onClick={() => start(d.key)} disabled={busy}>
              <strong>{d.name}</strong>
              <span>{d.rows}×{d.cols} · {(d.rows * d.cols) / 2} pairs</span>
              <span>⏱ {fmt(d.timeLimit * 1000)}</span>
              <span>+{d.matchPoints} / match</span>
              <span className="reward">🪙 {d.winReward} on win</span>
            </button>
          ))}
          {!difficulties.length && !error && <p className="muted">Loading…</p>}
        </div>
      </section>
    );
  }

  const pct = Math.round((game.pairsFound / game.totalPairs) * 100);
  const timePct = Math.max(0, Math.min(100, (msLeft / (game.timeLimit * 1000)) * 100));
  const low = msLeft < 15000 && !over;
  const won = game.status === 'won';

  return (
    <section className="game">
      <div className="hud">
        <div className="stat"><label>Time</label><b className={low ? 'danger' : ''}>{fmt(msLeft)}</b></div>
        <div className="stat"><label>Moves</label><b>{game.moves}</b></div>
        <div className="stat"><label>Score</label><b>{game.score}</b></div>
        <div className="stat"><label>Streak</label><b>{game.streak > 1 ? `🔥${game.streak}` : game.streak}</b></div>
      </div>
      <div className="bars">
        <div className="bar" title="Time left"><i className={low ? 'danger' : ''} style={{ width: `${timePct}%` }} /></div>
        <div className="bar progress" title="Pairs found"><i style={{ width: `${pct}%` }} /></div>
        <small className="muted">{game.pairsFound} / {game.totalPairs} pairs · {game.difficulty}</small>
      </div>
      {error && <div className="error">{error}</div>}

      <div
        className="board"
        style={{ '--cols': game.cols, '--rows': game.rows }}
        role="grid"
        aria-label="Memory cards"
      >
        {Array.from({ length: game.rows * game.cols }, (_, i) => {
          const up = faces[i] !== undefined;
          const matched = game.matched[i];
          return (
            <button
              key={i}
              className={`card ${up ? 'up' : ''} ${matched ? 'matched' : ''} ${wrong.includes(i) ? 'wrong' : ''}`}
              onClick={() => flip(i)}
              disabled={over || matched}
              aria-label={up ? `Card ${i + 1}: ${SYMBOLS[faces[i]]}` : `Card ${i + 1}, face down`}
            >
              <span className="inner">
                <span className="face back">?</span>
                <span className="face front">{up ? SYMBOLS[faces[i]] : ''}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="actions">
        <button className="btn ghost" onClick={toggleMute}>{muted ? '🔇 Sound off' : '🔊 Sound on'}</button>
        {!over && <button className="btn ghost" onClick={quit}>Quit</button>}
        {over && !showResult && <button className="btn primary" onClick={() => setShowResult(true)}>See result</button>}
      </div>

      {showResult && (
        <div className="overlay" role="dialog" aria-modal="true">
          <div className={`modal ${won ? 'win' : 'lose'}`}>
            <div className="emoji">{won ? '🏆' : '⏰'}</div>
            <h2>{won ? 'You win!' : "Time's up!"}</h2>
            <p className="muted">
              {won ? 'Every pair found.' : `You found ${game.pairsFound} of ${game.totalPairs} pairs.`}
            </p>
            <dl>
              <div><dt>Score</dt><dd>{game.score}</dd></div>
              <div><dt>Moves</dt><dd>{game.moves}</dd></div>
              <div><dt>Time</dt><dd>{fmt(game.durationMs || 0)}</dd></div>
              {won && <div><dt>Reward</dt><dd>🪙 {game.reward}</dd></div>}
            </dl>
            <div className="actions">
              <button className="btn primary" onClick={() => start(game.difficulty)} disabled={busy}>Play again</button>
              <button className="btn ghost" onClick={() => { setGame(null); setShowResult(false); }}>Change difficulty</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
