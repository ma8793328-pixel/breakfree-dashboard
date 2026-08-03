import { createContext, useContext, useEffect, useState } from 'react';
import { api } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem('bf_token') || null);
  const [user, setUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('bf_user')) || null;
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function validate() {
      const storedToken = localStorage.getItem('bf_token');
      if (!storedToken) {
        setLoading(false);
        return;
      }
      try {
        const data = await api('/auth/me', { token: storedToken });
        if (!active) return;
        setUser(data.user);
        localStorage.setItem('bf_user', JSON.stringify(data.user));
      } catch {
        if (!active) return;
        localStorage.removeItem('bf_token');
        localStorage.removeItem('bf_user');
        setToken(null);
        setUser(null);
      } finally {
        if (active) setLoading(false);
      }
    }
    validate();
    return () => {
      active = false;
    };
  }, []);

  function handleAuth(data) {
    localStorage.setItem('bf_token', data.token);
    localStorage.setItem('bf_user', JSON.stringify(data.user));
    setToken(data.token);
    setUser(data.user);
  }

  function logout() {
    fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    localStorage.removeItem('bf_token');
    localStorage.removeItem('bf_user');
    setToken(null);
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ token, user, loading, handleAuth, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
