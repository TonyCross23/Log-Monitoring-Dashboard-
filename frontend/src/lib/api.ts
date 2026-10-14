import { z } from 'zod';
import {
  authSessionSchema, createdProjectSchema, createProjectSchema, logFiltersSchema,
  logPageSchema, loginSchema, projectSchema, publicUserSchema, registerSchema,
  type AuthSession, type CreateProjectInput, type LogFilters, type LoginInput, type RegisterInput,
} from '@/lib/models';
import { useAuthStore } from '@/stores/auth-store';
import { monitorDashboardSchema } from '@/features/monitoring/monitoring.models';

export class ApiError extends Error {
  constructor(public readonly status: number, message: string, public readonly code = 'API_ERROR') {
    super(message);
    this.name = 'ApiError';
  }
}

const baseUrl = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
const errorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });
const envelope = <T>(schema: z.ZodType<T>) => z.object({ data: schema });
let refreshPromise: { generation: number; promise: Promise<AuthSession> } | null = null;
let authQueue: Promise<void> = Promise.resolve();

/** Cookie rotation is serialized across tabs when the browser supports Web Locks. */
function withAuthLock<T>(action: () => Promise<T>): Promise<T> {
  const run = authQueue.then(async (): Promise<T> => {
    if (typeof navigator !== 'undefined' && navigator.locks) {
      return await navigator.locks.request(`logline-auth:${baseUrl || 'same-origin'}`, action);
    }
    return await action();
  });
  // Serialize same-tab writes even in browsers without Web Locks.
  authQueue = run.then(() => undefined, () => undefined);
  return run;
}

function assertCurrentSession(generation: number): void {
  if (useAuthStore.getState().sessionGeneration !== generation) {
    throw new ApiError(401, 'Your session changed. Please try again.', 'SESSION_CHANGED');
  }
}

async function readResponse<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
  let body: unknown;
  try { body = await response.json() as unknown; }
  catch { throw new ApiError(response.status || 502, 'The server returned an unreadable response.', 'INVALID_RESPONSE'); }
  if (!response.ok) {
    const failure = errorSchema.safeParse(body);
    throw new ApiError(response.status, failure.success ? failure.data.error.message : 'The request could not be completed.', failure.success ? failure.data.error.code : 'API_ERROR');
  }
  const parsed = envelope(schema).safeParse(body);
  if (!parsed.success) throw new ApiError(502, 'The server returned data in an unexpected format.', 'INVALID_RESPONSE');
  return parsed.data.data;
}

async function send(path: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(`${baseUrl}/api/v1${path}`, { ...init, credentials: 'include' });
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new ApiError(0, 'Unable to connect to the API. Check your connection and backend server.', 'NETWORK_ERROR');
  }
}

function authWrite(body: object): RequestInit {
  return { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Protection': '1' }, body: JSON.stringify(body) };
}

/** A canceled query stops waiting without canceling another query's shared refresh. */
function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new DOMException('Request canceled.', 'AbortError'));
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new DOMException('Request canceled.', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    void promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

function refreshSession(generation: number): Promise<AuthSession> {
  if (refreshPromise?.generation === generation) return refreshPromise.promise;
  const promise = withAuthLock(async () => {
    assertCurrentSession(generation);
    const response = await send('/auth/refresh', authWrite({}));
    const session = await readResponse(response, authSessionSchema);
    assertCurrentSession(generation);
    const current = useAuthStore.getState();
    if (current.mode !== 'live' || (current.user && current.user.id !== session.user.id)) {
      throw new ApiError(401, 'Your session changed. Please sign in again.', 'SESSION_CHANGED');
    }
    // A token rotation retains the identity and generation of pending requests.
    useAuthStore.setState({ user: session.user, accessToken: session.accessToken });
    return session;
  }).catch((error: unknown) => {
    if (useAuthStore.getState().sessionGeneration === generation) useAuthStore.getState().clearSession();
    throw error;
  }).finally(() => {
    if (refreshPromise?.promise === promise) refreshPromise = null;
  });
  refreshPromise = { generation, promise };
  return promise;
}

async function authorized<T>(path: string, schema: z.ZodType<T>, init: RequestInit = {}): Promise<T> {
  const initial = useAuthStore.getState();
  if (initial.mode !== 'live' || !initial.accessToken) throw new ApiError(401, 'Sign in to connect to your projects.', 'UNAUTHORIZED');
  const generation = initial.sessionGeneration;
  const request = (token: string) => send(path, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } });
  let response = await request(initial.accessToken);
  assertCurrentSession(generation);
  if (response.status === 401) {
    const currentToken = useAuthStore.getState().accessToken;
    const token = currentToken && currentToken !== initial.accessToken
      ? currentToken
      : (await abortable(refreshSession(generation), init.signal ?? undefined)).accessToken;
    assertCurrentSession(generation);
    init.signal?.throwIfAborted();
    response = await request(token);
    assertCurrentSession(generation);
    if (response.status === 401) useAuthStore.getState().clearSession();
  }
  const result = await readResponse(response, schema);
  assertCurrentSession(generation);
  return result;
}

export const api = {
  getCeirMonitor(signal?: AbortSignal) {
    return authorized('/monitoring/ceir?limit=60', monitorDashboardSchema, { signal });
  },
  checkCeirMonitor() {
    return authorized('/monitoring/ceir/check', monitorDashboardSchema, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
  },
  async login(input: LoginInput): Promise<AuthSession> {
    const parsed = loginSchema.parse(input);
    const generation = useAuthStore.getState().sessionGeneration;
    return withAuthLock(async () => {
      assertCurrentSession(generation);
      const session = await readResponse(await send('/auth/login', authWrite(parsed)), authSessionSchema);
      assertCurrentSession(generation);
      useAuthStore.getState().setSession(session);
      return session;
    });
  },
  async register(input: RegisterInput) {
    const parsed = registerSchema.parse(input);
    const result = await readResponse(await send('/auth/register', authWrite(parsed)), z.object({ user: publicUserSchema }));
    return result.user;
  },
  async logout(): Promise<void> {
    const wasLive = useAuthStore.getState().mode === 'live';
    // Revoke memory immediately; a late refresh cannot restore a logged-out session.
    useAuthStore.getState().clearSession();
    if (!wasLive) return;
    await withAuthLock(async () => {
      const response = await send('/auth/logout', authWrite({}));
      if (!response.ok) await readResponse(response, z.never());
    });
  },
  listProjects(signal?: AbortSignal) {
    return authorized('/projects?limit=100', z.array(projectSchema), { signal });
  },
  createProject(input: CreateProjectInput) {
    const parsed = createProjectSchema.parse(input);
    return authorized('/projects', createdProjectSchema, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(parsed),
    });
  },
  fetchLogs(projectId: string, filters: LogFilters = {}, cursor?: string, signal?: AbortSignal) {
    const id = z.uuid().parse(projectId);
    const input = logFiltersSchema.parse(filters);
    const query = new URLSearchParams({ limit: String(input.limit ?? 50) });
    if (input.level && input.level !== 'ALL') query.set('level', input.level);
    if (input.search) query.set('search', input.search);
    if (input.from) query.set('from', input.from);
    if (input.to) query.set('to', input.to);
    if (cursor) query.set('cursor', cursor);
    return authorized(`/projects/${id}/logs?${query}`, logPageSchema, { signal });
  },
};
