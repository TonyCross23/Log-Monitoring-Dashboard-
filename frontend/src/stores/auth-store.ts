import { create } from 'zustand';
import type { AuthSession, PublicUser } from '@/lib/models';

export const DEMO_USER: PublicUser = {
  id: 'a593bdf3-9eb8-4fad-a482-456797281bb8',
  name: 'Maya Chen', email: 'maya@example.com', createdAt: '2026-09-01T08:00:00.000Z',
};

interface AuthState {
  mode: 'demo' | 'live';
  user: PublicUser | null;
  accessToken: string | null;
  /** Invalidates requests started before a login, logout, or demo-mode change. */
  sessionGeneration: number;
  setSession: (session: AuthSession) => void;
  enterDemo: () => void;
  clearSession: () => void;
  logout: () => void;
}

// Tokens deliberately remain in memory. The server owns the httpOnly refresh cookie.
export const useAuthStore = create<AuthState>((set) => {
  const clearSession = () => set((state) => ({
    mode: 'live', user: null, accessToken: null, sessionGeneration: state.sessionGeneration + 1,
  }));
  return {
    mode: 'demo', user: DEMO_USER, accessToken: null, sessionGeneration: 0,
    setSession: (session) => set((state) => ({
      mode: 'live', user: session.user, accessToken: session.accessToken,
      sessionGeneration: state.sessionGeneration + 1,
    })),
    enterDemo: () => set((state) => ({
      mode: 'demo', user: DEMO_USER, accessToken: null, sessionGeneration: state.sessionGeneration + 1,
    })),
    clearSession,
    logout: clearSession,
  };
});
