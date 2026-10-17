import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { authUserResponseSchema, csrfResponseSchema } from '@hirereach/contracts';
import { api } from '../../lib/api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState('loading');
  const [expired, setExpired] = useState(false);

  const refresh = useCallback(async () => {
    setStatus('loading');
    try {
      const response = await api.get('/auth/me');
      const result = authUserResponseSchema.parse(response.data);
      setUser(result.data.user);
      setExpired(false);
      setStatus('authenticated');
    } catch (error) {
      if (error.response?.status === 401) {
        setExpired(error.response.headers['x-session-expired'] === 'true');
        setUser(null);
        setStatus('unauthenticated');
      } else {
        setStatus('unavailable');
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const handleExpired = () => {
      setUser(null);
      setStatus('unauthenticated');
      setExpired(true);
    };
    window.addEventListener('auth:expired', handleExpired);
    return () => window.removeEventListener('auth:expired', handleExpired);
  }, []);

  const getCsrfToken = useCallback(async () => {
    const response = await api.get('/auth/csrf');
    return csrfResponseSchema.parse(response.data).data.csrfToken;
  }, []);

  const completeLogin = useCallback((authenticatedUser) => {
    setUser(authenticatedUser);
    setExpired(false);
    setStatus('authenticated');
  }, []);

  const logout = useCallback(async () => {
    const csrfToken = await getCsrfToken();
    await api.post('/auth/logout', {}, { headers: { 'X-CSRF-Token': csrfToken } });
    setUser(null);
    setExpired(false);
    setStatus('unauthenticated');
  }, [getCsrfToken]);

  const value = useMemo(
    () => ({ user, status, expired, refresh, getCsrfToken, completeLogin, logout }),
    [user, status, expired, refresh, getCsrfToken, completeLogin, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider.');
  return context;
}

export function RequireAuth() {
  const { status, expired, refresh } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return <p className="p-8 text-center text-sm text-slate-500" role="status">Checking your session…</p>;
  }
  if (status === 'unavailable') {
    return (
      <section className="mx-auto mt-16 max-w-md panel p-8 text-center">
        <h1 className="text-lg font-semibold">Workspace unavailable</h1>
        <p className="mt-2 text-sm text-slate-500">
          We could not verify your session. Check the API and database connection, then retry.
        </p>
        <button className="button-secondary mt-5" onClick={() => void refresh()}>
          Try again
        </button>
      </section>
    );
  }
  if (status !== 'authenticated') {
    return <Navigate to="/login" replace state={{ from: location, expired }} />;
  }
  return <Outlet />;
}

export function GuestOnly() {
  const { status, refresh } = useAuth();
  if (status === 'loading') {
    return <p className="p-8 text-center text-sm text-slate-500" role="status">Checking your session…</p>;
  }
  if (status === 'unavailable') {
    return (
      <section className="mx-auto mt-16 max-w-md panel p-8 text-center">
        <h1 className="text-lg font-semibold">Authentication unavailable</h1>
        <p className="mt-2 text-sm text-slate-500">
          Registration and sign-in require the configured MongoDB database.
        </p>
        <button className="button-secondary mt-5" onClick={() => void refresh()}>
          Try again
        </button>
      </section>
    );
  }
  if (status === 'authenticated') return <Navigate to="/dashboard" replace />;
  return <Outlet />;
}
