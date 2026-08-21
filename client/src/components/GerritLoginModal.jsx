import React, { useState, useEffect, useRef } from 'react';
import { useSelector } from 'react-redux';
import './css/GerritLoginModal.css';

function GerritLoginModal({ visible, onClose, onSuccess }) {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showPassword, setShowPassword] = useState(false);
  const inputRef = useRef(null);
  const userFromState = useSelector((state) => state.auth && state.auth.user) || null;

  useEffect(() => {
    if (visible) {
      setError(null);
      setPassword('');
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [visible]);

  if (!visible) return null;

  const submit = async () => {
    const username = userFromState?.name;

    if (!password) {
      setError('Please enter password');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/gerrit/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || 'Authentication failed');
        setLoading(false);
        return;
      }

      setLoading(false);
      // Persist Gerrit token on frontend (returned by server)
      try {
        if (data?.token) {
          sessionStorage.setItem('gerrit_token', String(data.token));
        }
      } catch (e) {
        // ignore
      }

      onSuccess && onSuccess({ username, data });
      onClose && onClose();
    } catch (err) {
      setError('Network error');
      setLoading(false);
    }
  };

  const handleKey = (e) => {
    if (e.key === 'Enter') submit();
    if (e.key === 'Escape') onClose && onClose();
  };

  return (
    <div className="gerrit-modal-overlay" role="dialog" aria-modal="true" onKeyDown={handleKey}>
      <div className="gerrit-card">
        <div className="gerrit-header">
            <div className="gerrit-header-text">
              <div className="gerrit-title">Sign in to Gerrit</div>
              <div className="gerrit-subtitle">
                {`To get HTTP Password login to wall.lge.com > settings > HTTP Credentials and generate new password.`}
              </div>
            </div>
          <button aria-label="Close" onClick={() => onClose && onClose()} className="gerrit-close">×</button>
        </div>

        <div className="gerrit-form">
          <div style={{ marginBottom: 6 }} />
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="gerrit-input"
              placeholder="HTTP password"
              ref={inputRef}
              style={{ flex: 1 }}
            />
            <button onClick={() => setShowPassword(s => !s)} className="gerrit-toggle">{showPassword ? 'Hide' : 'Show'}</button>
          </div>

          {error && <div className="gerrit-error">{error}</div>}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 18 }}>
            <button onClick={() => onClose && onClose()} disabled={loading} className="gerrit-ghost">Cancel</button>
            <button onClick={submit} disabled={loading} className="gerrit-primary">{loading ? 'Signing...' : 'Sign in'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default GerritLoginModal;
