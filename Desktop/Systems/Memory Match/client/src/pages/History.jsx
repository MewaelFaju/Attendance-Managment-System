import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';

export const fmtDuration = (ms = 0) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export default function History() {
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api(`/game/history?page=${page}&limit=10`).then(setData).catch((e) => setError(e.message));
  }, [page]);

  return (
    <section className="page">
      <h1>Your history</h1>
      <div className="summary">
        <div className="stat"><label>Games</label><b>{user.gamesPlayed}</b></div>
        <div className="stat"><label>Wins</label><b>{user.gamesWon}</b></div>
        <div className="stat"><label>Win rate</label><b>{user.gamesPlayed ? Math.round((user.gamesWon / user.gamesPlayed) * 100) : 0}%</b></div>
        <div className="stat"><label>Total score</label><b>{user.totalScore}</b></div>
      </div>
      {error && <div className="error">{error}</div>}
      {!data ? <p className="muted">Loading…</p> : data.items.length === 0 ? <p className="muted">No games yet. Go play one!</p> : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>When</th><th>Level</th><th>Result</th><th>Score</th><th>Moves</th><th>Pairs</th><th>Time</th><th>Reward</th></tr>
            </thead>
            <tbody>
              {data.items.map((g) => (
                <tr key={g._id}>
                  <td>{new Date(g.endedAt).toLocaleString()}</td>
                  <td className="cap">{g.difficulty}</td>
                  <td><span className={`tag ${g.status}`}>{g.status}</span></td>
                  <td>{g.score}</td>
                  <td>{g.moves}</td>
                  <td>{g.pairsFound}/{g.totalPairs}</td>
                  <td>{fmtDuration(g.durationMs)}</td>
                  <td>{g.reward ? `🪙 ${g.reward}` : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && data.pages > 1 && (
        <div className="pager">
          <button className="btn ghost sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</button>
          <span>{page} / {data.pages}</span>
          <button className="btn ghost sm" disabled={page >= data.pages} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      )}
    </section>
  );
}
