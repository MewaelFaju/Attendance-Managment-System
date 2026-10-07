import { useState } from 'react';
import { useAuth } from '../auth.jsx';

export default function Login() {
  const { authenticate } = useAuth();
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ username: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const payload = mode === 'login' ? { email: form.email, password: form.password } : form;
      await authenticate(mode, payload);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth card-panel">
      <h1>{mode === 'login' ? 'Welcome back' : 'Create account'}</h1>
      <p className="muted">Flip cards, find pairs, climb the leaderboard.</p>
      <form onSubmit={submit}>
        {mode === 'register' && (
          <label>
            Username
            <input value={form.username} onChange={set('username')} required minLength={3} maxLength={20} autoComplete="username" />
          </label>
        )}
        <label>
          Email
          <input type="email" value={form.email} onChange={set('email')} required autoComplete="email" />
        </label>
        <label>
          Password
          <input
            type="password"
            value={form.password}
            onChange={set('password')}
            required
            minLength={mode === 'register' ? 8 : 1}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          />
        </label>
        {error && <div className="error">{error}</div>}
        <button className="btn primary" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Sign up'}</button>
      </form>
      <button className="link" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}>
        {mode === 'login' ? "No account? Sign up" : 'Have an account? Log in'}
      </button>
    </div>
  );
}
