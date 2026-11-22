import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import AuthShell, { AuthField, AuthSubmit } from '../components/AuthShell';

export default function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.login({ email, password });
      navigate('/dashboard');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell title="Sign in to continue">
      {error && <div className="error-box">{error}</div>}
      <form onSubmit={onSubmit} className="auth-form">
        <AuthField
          icon="mail"
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
        />
        <AuthField
          icon="lock"
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="current-password"
        />
        <AuthSubmit loading={loading} idle="Sign in" busy="Signing in…" />
      </form>
      <Link to="/register" className="auth-link">Create an account ➜</Link>
    </AuthShell>
  );
}
