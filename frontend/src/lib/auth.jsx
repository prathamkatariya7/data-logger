import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api } from './api.js';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [state, setState] = useState({ loading: true, authEnabled: false, authenticated: false, user: null });

  const refresh = useCallback(async () => {
    try {
      const s = await api.authStatus();
      setState({
        loading: false,
        authEnabled: s.auth_enabled,
        authenticated: s.authenticated,
        user: s.user || null, // { username, role } or null
      });
    } catch (_) {
      setState({ loading: false, authEnabled: true, authenticated: false, user: null });
    }
  }, []);

  useEffect(() => {
    refresh();
    const onRequired = () => setState((s) => ({ ...s, authenticated: false, user: null }));
    window.addEventListener('auth:required', onRequired);
    return () => window.removeEventListener('auth:required', onRequired);
  }, [refresh]);

  const login = useCallback(async (username, password) => {
    await api.login(username, password);
    await refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    await api.logout();
    setState((s) => ({ ...s, authenticated: false, user: null }));
  }, []);

  const changePassword = useCallback(async (currentPassword, newPassword) => {
    await api.changePassword(currentPassword, newPassword);
  }, []);

  return <AuthCtx.Provider value={{ ...state, login, logout, refresh, changePassword }}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

