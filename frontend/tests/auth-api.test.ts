import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../src/lib/api';
import type { AuthSession } from '../src/lib/models';
import { DEMO_USER, useAuthStore } from '../src/stores/auth-store';

const session: AuthSession = { user: DEMO_USER, accessToken: 'old-token', tokenType: 'Bearer', expiresIn: 900 };
const refreshedSession: AuthSession = { ...session, accessToken: 'new-token' };
const response = (data: unknown, status = 200) => new Response(JSON.stringify({ data }), { status, headers: { 'Content-Type': 'application/json' } });
const unauthorized = () => new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } }), { status: 401 });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => { resolve = finish; });
  return { promise, resolve };
}

beforeEach(() => { useAuthStore.getState().setSession(session); });
afterEach(() => { vi.unstubAllGlobals(); useAuthStore.getState().enterDemo(); });

describe('typed API and authentication lifecycle', () => {
  it('shares a single refresh when two protected requests expire together', async () => {
    const pending = deferred<Response>();
    const started = deferred<void>();
    let refreshCount = 0;
    let oldTokenRequests = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/auth/refresh')) {
        refreshCount++;
        expect(new Headers(init?.headers).get('X-CSRF-Protection')).toBe('1');
        expect(init?.credentials).toBe('include');
        started.resolve();
        return pending.promise;
      }
      if (new Headers(init?.headers).get('Authorization') === 'Bearer old-token') { oldTokenRequests++; return unauthorized(); }
      return response([]);
    });
    vi.stubGlobal('fetch', fetchMock);
    const requests = Promise.all([api.listProjects(), api.listProjects()]);
    await started.promise;
    pending.resolve(response(refreshedSession));
    expect(await requests).toEqual([[], []]);
    expect(refreshCount).toBe(1);
    expect(oldTokenRequests).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(useAuthStore.getState().accessToken).toBe('new-token');
  });

  it('does not refresh a rejected login', async () => {
    const fetchMock = vi.fn(async () => unauthorized());
    vi.stubGlobal('fetch', fetchMock);
    await expect(api.login({ email: 'maya@example.com', password: 'incorrect' })).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().accessToken).toBe('old-token');
  });

  it('prevents a pending refresh from resurrecting a logged-out session', async () => {
    const pending = deferred<Response>();
    const started = deferred<void>();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/auth/refresh')) { started.resolve(); return pending.promise; }
      if (String(input).endsWith('/auth/logout')) return new Response(null, { status: 204 });
      return unauthorized();
    });
    vi.stubGlobal('fetch', fetchMock);
    const request = api.listProjects();
    const rejection = expect(request).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
    await started.promise;
    const logout = api.logout();
    expect(useAuthStore.getState().accessToken).toBeNull();
    pending.resolve(response(refreshedSession));
    await Promise.all([rejection, logout]);
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('clears memory when the refresh cookie is invalid', async () => {
    const fetchMock = vi.fn(async () => unauthorized());
    vi.stubGlobal('fetch', fetchMock);
    await expect(api.listProjects()).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  it('rejects malformed successful responses at the API boundary', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response([{ id: 'invalid-project', name: 'missing-fields' }])));
    await expect(api.listProjects()).rejects.toMatchObject({ code: 'INVALID_RESPONSE', status: 502 });
  });

  it('discards an old account response when the session changes during body parsing', async () => {
    const pending = deferred<unknown>();
    const started = deferred<void>();
    const result = response([]);
    vi.spyOn(result, 'json').mockImplementation(() => { started.resolve(); return pending.promise; });
    vi.stubGlobal('fetch', vi.fn(async () => result));
    const request = api.listProjects();
    const rejection = expect(request).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
    await started.promise;
    useAuthStore.getState().enterDemo();
    pending.resolve({ data: [] });
    await rejection;
    expect(useAuthStore.getState().mode).toBe('demo');
  });

  it('keeps access tokens cleared even when server logout is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Connection failed'); }));
    await expect(api.logout()).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
  });

  it('passes query cancellation to fetch and does not clear a valid session', async () => {
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.signal).toBe(controller.signal);
      throw new DOMException('Aborted', 'AbortError');
    }));
    await expect(api.listProjects(controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(useAuthStore.getState().accessToken).toBe('old-token');
  });
});
