import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'next/router';
import * as api from '@/lib/api';
import { ApiError } from '@/lib/api';
import type { User } from '@/lib/types';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  /** Set when the API could not be reached at all — distinct from "logged out". */
  unavailable: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function messageOf(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'Unexpected error';
}

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const current = await api.me();
      if (!mounted.current) return;
      setUser(current);
      setUnavailable(false);
      setError(null);
    } catch (caught) {
      if (!mounted.current) return;
      setUser(null);
      // A downed backend is not an authentication failure: keep the user on the
      // page and surface the connection problem instead of bouncing to /login.
      setUnavailable(caught instanceof ApiError && caught.isNetworkError);
      setError(messageOf(caught));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  // One `GET /api/auth/me` for the whole app, on mount.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (email: string, password: string): Promise<void> => {
    const session = await api.login(email, password);
    setUser(session.user);
    setUnavailable(false);
    setError(null);
  }, []);

  const register = useCallback(async (email: string, password: string): Promise<void> => {
    const session = await api.register(email, password);
    setUser(session.user);
    setUnavailable(false);
    setError(null);
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    try {
      await api.logout();
    } catch {
      // Clearing local state is enough: the cookie may already be gone.
    }
    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, unavailable, error, login, register, logout, refresh }),
    [user, loading, unavailable, error, login, register, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export interface UseAuthOptions {
  /** Redirect to /login when the session is missing. */
  required?: boolean;
  /** Where to send the user after a successful login (defaults to current path). */
  redirectTo?: string;
}

export type UseAuthResult = AuthContextValue;

/**
 * Auth access for pages. Mounts on top of AuthProvider (see pages/_app.tsx) so
 * `me()` is called once per session, not once per component.
 */
export function useAuth(options: UseAuthOptions = {}): UseAuthResult {
  const context = useContext(AuthContext);
  const router = useRouter();
  const { required = false, redirectTo } = options;

  if (!context) {
    throw new Error('useAuth must be used inside <AuthProvider> (pages/_app.tsx)');
  }

  const { user, loading, unavailable } = context;

  useEffect(() => {
    if (!required || loading) return;
    if (user) return;
    // Don't treat "backend unreachable" as "logged out": that would bounce a
    // logged-in user to /login whenever the API restarts.
    if (unavailable) return;
    const next = redirectTo ?? (router.asPath.startsWith('/login') ? '/dashboard' : router.asPath);
    void router.replace(`/login?next=${encodeURIComponent(next)}`);
  }, [required, loading, user, unavailable, redirectTo, router]);

  return context;
}
