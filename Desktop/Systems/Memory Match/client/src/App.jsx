import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import Login from './pages/Login.jsx';
import Game from './pages/Game.jsx';
import History from './pages/History.jsx';
import Leaderboard from './pages/Leaderboard.jsx';
import Admin from './pages/Admin.jsx';

function Protected({ children, admin }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="center muted">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (admin && user.role !== 'admin') return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  const { user, logout } = useAuth();
  return (
    <div className="app">
      <header className="nav">
        <NavLink to="/" className="brand">
          🧠 <span>Memory Match</span>
        </NavLink>
        {user && (
          <nav className="links">
            <NavLink to="/" end>Play</NavLink>
            <NavLink to="/history">History</NavLink>
            <NavLink to="/leaderboard">Leaders</NavLink>
            {user.role === 'admin' && <NavLink to="/admin">Admin</NavLink>}
          </nav>
        )}
        {user && (
          <div className="me">
            <span className="chip" title="Coins">🪙 {user.coins}</span>
            <span className="name">{user.username}</span>
            <button className="btn ghost sm" onClick={logout}>Log out</button>
          </div>
        )}
      </header>
      <main>
        <Routes>
          <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
          <Route path="/" element={<Protected><Game /></Protected>} />
          <Route path="/history" element={<Protected><History /></Protected>} />
          <Route path="/leaderboard" element={<Protected><Leaderboard /></Protected>} />
          <Route path="/admin" element={<Protected admin><Admin /></Protected>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
