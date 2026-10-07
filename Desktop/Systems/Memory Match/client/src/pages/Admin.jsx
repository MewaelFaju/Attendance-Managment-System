import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { fmtDuration } from './History.jsx';

const TABS = ['Statistics', 'Difficulties', 'Users', 'Recent games'];

export default function Admin() {
  const [tab, setTab] = useState(TABS[0]);
  return (
    <section className="page">
      <h1>Admin dashboard</h1>
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>
      {tab === 'Statistics' && <Stats />}
      {tab === 'Difficulties' && <Difficulties />}
      {tab === 'Users' && <Users />}
      {tab === 'Recent games' && <Recent />}
    </section>
  );
}

function useLoad(path) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => api(path).then(setData).catch((e) => setError(e.message)), [path]);
  useEffect(() => { load(); }, [load]);
  return { data, error, reload: load };
}

function Stats() {
  const { data: s, error } = useLoad('/admin/stats');
  if (error) return <div className="error">{error}</div>;
  if (!s) return <p className="muted">Loading…</p>;
  const maxDay = Math.max(1, ...s.last7Days.map((d) => d.played));
  return (
    <>
      <div className="summary">
        <div className="stat"><label>Players</label><b>{s.users}</b></div>
        <div className="stat"><label>Games finished</label><b>{s.gamesFinished}</b></div>
        <div className="stat"><label>Win rate</label><b>{Math.round(s.winRate * 100)}%</b></div>
        <div className="stat"><label>Active now</label><b>{s.gamesActive}</b></div>
        <div className="stat"><label>Avg win time</label><b>{fmtDuration(s.avgWinTimeMs)}</b></div>
        <div className="stat"><label>Avg win moves</label><b>{Math.round(s.avgWinMoves)}</b></div>
      </div>
      <h3>By difficulty</h3>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Level</th><th>Played</th><th>Won</th><th>Win rate</th><th>Avg score</th><th>Avg moves</th><th>Coins paid</th></tr></thead>
          <tbody>
            {s.byDifficulty.map((d) => (
              <tr key={d.difficulty}>
                <td className="cap">{d.difficulty}</td><td>{d.played}</td><td>{d.won}</td>
                <td>{Math.round((d.won / d.played) * 100)}%</td>
                <td>{Math.round(d.avgScore)}</td><td>{Math.round(d.avgMoves)}</td><td>{d.coinsPaid}</td>
              </tr>
            ))}
            {!s.byDifficulty.length && <tr><td colSpan="7" className="muted">No games yet</td></tr>}
          </tbody>
        </table>
      </div>
      <h3>Last 7 days</h3>
      <div className="chart">
        {s.last7Days.map((d) => (
          <div key={d.date} className="col" title={`${d.date}: ${d.won} won / ${d.played} played`}>
            <div className="bar-v" style={{ height: `${(d.played / maxDay) * 100}%` }}>
              <i style={{ height: `${(d.won / d.played) * 100}%` }} />
            </div>
            <small>{d.date.slice(5)}</small>
          </div>
        ))}
        {!s.last7Days.length && <p className="muted">No activity yet</p>}
      </div>
    </>
  );
}

const FIELDS = [
  ['name', 'Name', 'text'],
  ['key', 'Key', 'text'],
  ['rows', 'Rows', 'number'],
  ['cols', 'Cols', 'number'],
  ['timeLimit', 'Time limit (s)', 'number'],
  ['matchPoints', 'Points / match', 'number'],
  ['mismatchPenalty', 'Mismatch penalty', 'number'],
  ['streakBonus', 'Streak bonus', 'number'],
  ['timeBonusPerSecond', 'Time bonus / s', 'number'],
  ['winReward', 'Win reward (coins)', 'number'],
  ['order', 'Order', 'number'],
];
const BLANK = { key: '', name: '', rows: 4, cols: 4, timeLimit: 120, matchPoints: 100, mismatchPenalty: 5, streakBonus: 20, timeBonusPerSecond: 2, winReward: 10, enabled: true, order: 9 };

function Difficulties() {
  const { data, error, reload } = useLoad('/admin/difficulties');
  const [draft, setDraft] = useState(null);
  if (error) return <div className="error">{error}</div>;
  if (!data) return <p className="muted">Loading…</p>;
  return (
    <>
      <div className="diff-admin">
        {data.items.map((d) => <DiffForm key={d._id + d.updatedAt} item={d} onSaved={reload} />)}
      </div>
      {draft ? (
        <DiffForm item={draft} isNew onSaved={() => { setDraft(null); reload(); }} onCancel={() => setDraft(null)} />
      ) : (
        <button className="btn primary" onClick={() => setDraft(BLANK)}>+ Add difficulty</button>
      )}
    </>
  );
}

function DiffForm({ item, isNew, onSaved, onCancel }) {
  const [f, setF] = useState(item);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k, type) => (e) => setF({ ...f, [k]: type === 'number' ? Number(e.target.value) : e.target.value });

  async function save() {
    setBusy(true);
    setMsg('');
    const { _id, createdAt, updatedAt, __v, ...body } = f;
    try {
      if (isNew) await api('/admin/difficulties', { method: 'POST', body });
      else await api(`/admin/difficulties/${_id}`, { method: 'PUT', body });
      setMsg('Saved');
      onSaved?.();
    } catch (e) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!window.confirm(`Delete "${f.name}"? Past games are kept.`)) return;
    try {
      await api(`/admin/difficulties/${f._id}`, { method: 'DELETE' });
      onSaved?.();
    } catch (e) {
      setMsg(e.message);
    }
  }

  return (
    <div className="card-panel diff-form">
      <div className="fields">
        {FIELDS.map(([k, label, type]) => (
          <label key={k}>
            {label}
            <input type={type} value={f[k]} onChange={set(k, type)} />
          </label>
        ))}
        <label className="check">
          <input type="checkbox" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} /> Enabled
        </label>
      </div>
      <div className="actions">
        <button className="btn primary sm" onClick={save} disabled={busy}>{isNew ? 'Create' : 'Save'}</button>
        {isNew ? <button className="btn ghost sm" onClick={onCancel}>Cancel</button> : <button className="btn ghost sm" onClick={remove}>Delete</button>}
        {msg && <span className={msg === 'Saved' ? 'ok' : 'error inline'}>{msg}</span>}
      </div>
    </div>
  );
}

function Users() {
  const { data, error, reload } = useLoad('/admin/users');
  const [msg, setMsg] = useState('');
  async function patch(id, body) {
    setMsg('');
    try {
      await api(`/admin/users/${id}`, { method: 'PATCH', body });
      reload();
    } catch (e) {
      setMsg(e.message);
    }
  }
  if (error) return <div className="error">{error}</div>;
  if (!data) return <p className="muted">Loading…</p>;
  return (
    <>
      {msg && <div className="error">{msg}</div>}
      <div className="table-wrap">
        <table>
          <thead><tr><th>User</th><th>Role</th><th>Games</th><th>Wins</th><th>Score</th><th>Coins</th><th></th></tr></thead>
          <tbody>
            {data.items.map((u) => (
              <tr key={u._id}>
                <td>{u.username}<br /><small className="muted">{u.email}</small></td>
                <td><span className="tag">{u.role}</span>{u.banned && <span className="tag lost">banned</span>}</td>
                <td>{u.gamesPlayed}</td><td>{u.gamesWon}</td><td>{u.totalScore}</td><td>{u.coins}</td>
                <td className="row-actions">
                  <button className="btn ghost sm" onClick={() => patch(u._id, { banned: !u.banned })}>{u.banned ? 'Unban' : 'Ban'}</button>
                  <button className="btn ghost sm" onClick={() => patch(u._id, { role: u.role === 'admin' ? 'user' : 'admin' })}>
                    {u.role === 'admin' ? 'Demote' : 'Make admin'}
                  </button>
                  <button className="btn ghost sm" onClick={() => {
                    const v = window.prompt('Set coin balance', u.coins);
                    if (v !== null && v.trim() !== '' && Number.isInteger(Number(v)) && Number(v) >= 0) patch(u._id, { coins: Number(v) });
                  }}>Coins</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Recent() {
  const { data, error } = useLoad('/admin/games');
  if (error) return <div className="error">{error}</div>;
  if (!data) return <p className="muted">Loading…</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>When</th><th>Player</th><th>Level</th><th>Result</th><th>Score</th><th>Moves</th><th>Time</th></tr></thead>
        <tbody>
          {data.items.map((g) => (
            <tr key={g._id}>
              <td>{new Date(g.endedAt).toLocaleString()}</td>
              <td>{g.user?.username ?? '—'}</td>
              <td className="cap">{g.difficulty}</td>
              <td><span className={`tag ${g.status}`}>{g.status}</span></td>
              <td>{g.score}</td><td>{g.moves}</td><td>{fmtDuration(g.durationMs)}</td>
            </tr>
          ))}
          {!data.items.length && <tr><td colSpan="7" className="muted">No games yet</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
