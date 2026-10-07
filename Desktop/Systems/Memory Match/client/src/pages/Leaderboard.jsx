import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { fmtDuration } from './History.jsx';

export default function Leaderboard() {
  const [diffs, setDiffs] = useState([]);
  const [level, setLevel] = useState('');
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/game/difficulties').then((d) => setDiffs(d.items)).catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    setItems(null);
    api(`/game/leaderboard${level ? `?difficulty=${encodeURIComponent(level)}` : ''}`)
      .then((d) => setItems(d.items))
      .catch((e) => setError(e.message));
  }, [level]);

  return (
    <section className="page">
      <h1>Leaderboard</h1>
      <div className="tabs">
        <button className={!level ? 'on' : ''} onClick={() => setLevel('')}>All</button>
        {diffs.map((d) => (
          <button key={d.key} className={level === d.key ? 'on' : ''} onClick={() => setLevel(d.key)}>{d.name}</button>
        ))}
      </div>
      {error && <div className="error">{error}</div>}
      {!items ? <p className="muted">Loading…</p> : items.length === 0 ? <p className="muted">No wins recorded yet.</p> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>#</th><th>Player</th><th>Score</th><th>Moves</th><th>Time</th><th>Level</th></tr></thead>
            <tbody>
              {items.map((r, i) => (
                <tr key={r.username}>
                  <td>{['🥇', '🥈', '🥉'][i] || i + 1}</td>
                  <td>{r.username}</td>
                  <td>{r.score}</td>
                  <td>{r.moves}</td>
                  <td>{fmtDuration(r.durationMs)}</td>
                  <td className="cap">{r.difficulty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
