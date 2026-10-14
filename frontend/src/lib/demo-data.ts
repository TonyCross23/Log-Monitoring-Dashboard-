import { createProjectSchema, logFiltersSchema, type CreatedProject, type LogEntry, type LogFilters, type LogLevel, type LogPage, type Project } from '@/lib/models';

export const DEMO_PROJECT_IDS = {
  payments: '1e369bc4-ea0d-45b7-aec8-a26ce6f877d4',
  web: 'e469b3d1-9b0e-4dc5-ae9f-6ecdfce6a632',
  worker: 'fa42da82-6f44-487d-bcbf-682ad8e7fc4b',
} as const;
export const DEMO_NOW = Date.now();
const createdAt = new Date(DEMO_NOW - 21 * 86_400_000).toISOString();
const projects: Project[] = [
  { id: DEMO_PROJECT_IDS.payments, name: 'payments-api', apiKeyPrefix: 'lmd_demo_pay', createdAt, updatedAt: createdAt },
  { id: DEMO_PROJECT_IDS.web, name: 'web-app', apiKeyPrefix: 'lmd_demo_web', createdAt, updatedAt: createdAt },
  { id: DEMO_PROJECT_IDS.worker, name: 'background-worker', apiKeyPrefix: 'lmd_demo_job', createdAt, updatedAt: createdAt },
];

interface LogSample { level: LogLevel; message: string; service: string; path?: string; duration?: number }
const samples: LogSample[] = [
  { level: 'INFO', message: 'Payment processed successfully', service: 'payments', path: '/v1/payments', duration: 142 },
  { level: 'ERROR', message: 'Connection timeout to payment provider', service: 'payments', path: '/v1/payments', duration: 5_004 },
  { level: 'INFO', message: 'Request completed: GET /v1/customers', service: 'gateway', path: '/v1/customers', duration: 38 },
  { level: 'WARN', message: 'Rate limit approaching for upstream API', service: 'gateway', path: '/v1/charges' },
  { level: 'INFO', message: 'Webhook delivered to merchant endpoint', service: 'webhooks', duration: 216 },
  { level: 'DEBUG', message: 'Cache hit for customer session', service: 'cache', duration: 3 },
  { level: 'INFO', message: 'Refund initiated for transaction', service: 'payments', path: '/v1/refunds', duration: 96 },
  { level: 'INFO', message: 'Request completed: GET /health', service: 'gateway', path: '/health', duration: 2 },
  { level: 'WARN', message: 'Database connection pool nearing capacity', service: 'database' },
  { level: 'ERROR', message: 'Webhook signature verification failed', service: 'webhooks', path: '/v1/webhooks' },
  { level: 'INFO', message: 'Scheduled reconciliation completed', service: 'reconciliation', duration: 1_829 },
  { level: 'TRACE', message: 'Request trace span finished', service: 'gateway', path: '/v1/payments', duration: 18 },
  { level: 'INFO', message: 'New customer record created', service: 'customers', path: '/v1/customers', duration: 84 },
  { level: 'DEBUG', message: 'Retry scheduled with exponential backoff', service: 'queue' },
  { level: 'FATAL', message: 'Worker exited after repeated database failures', service: 'worker' },
];

function makeLogs(projectId: string, count: number, offset: number): LogEntry[] {
  return Array.from({ length: count }, (_, index) => {
    const sample = samples[(index * 7 + offset) % samples.length];
    if (!sample) throw new Error('Demo sample not found.');
    const age = index < 32 ? 15_000 + index * 74_000 : 3_600_000 + (index - 32) * (78_000_000 / Math.max(1, count - 32));
    const isError = sample.level === 'ERROR' || sample.level === 'FATAL';
    return {
      id: `00000000-0000-4000-8000-${String(offset * 1_000 + index + 1).padStart(12, '0')}`,
      projectId,
      level: sample.level,
      message: sample.message,
      stackTrace: isError ? `TimeoutError: ${sample.message}\n    at PaymentProvider.request (src/providers/payment-provider.ts:87:13)\n    at async PaymentService.process (src/features/payments/payment.service.ts:142:22)\n    at async processPayment (src/features/payments/payment.controller.ts:38:7)` : null,
      metadata: {
        service: sample.service, environment: 'production',
        requestId: `req_${(offset * 100_000 + index).toString(16).padStart(8, '0')}`,
        ...(sample.path ? { method: sample.path === '/health' ? 'GET' : 'POST', path: sample.path } : {}),
        ...(sample.duration !== undefined ? { durationMs: sample.duration + (index % 11) } : {}),
        ...(isError ? { retryable: true, attempt: 3, provider: 'sandbox-provider' } : {}),
      },
      createdAt: new Date(DEMO_NOW - age - offset * 400).toISOString(),
    };
  });
}
const logs: LogEntry[] = [
  ...makeLogs(DEMO_PROJECT_IDS.payments, 154, 1),
  ...makeLogs(DEMO_PROJECT_IDS.web, 68, 2).map((log) => ({ ...log, message: log.level === 'ERROR' ? 'Server rendering failed for dashboard route' : log.message })),
  ...makeLogs(DEMO_PROJECT_IDS.worker, 52, 3).map((log) => ({ ...log, message: log.level === 'INFO' ? 'Background job completed successfully' : log.message })),
].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));

export function listDemoProjects(): Project[] { return structuredClone(projects); }

/** Match the API's level, substring-search, date, and cursor-pagination behavior. */
export function fetchDemoLogs(projectId: string, filters: LogFilters = {}, cursor?: string): LogPage {
  const input = logFiltersSchema.parse(filters);
  const search = input.search?.toLocaleLowerCase();
  const matches = logs.filter((log) => log.projectId === projectId
    && (!input.level || input.level === 'ALL' || log.level === input.level)
    && (!search || log.message.toLocaleLowerCase().includes(search))
    && (!input.from || Date.parse(log.createdAt) >= Date.parse(input.from))
    && (!input.to || Date.parse(log.createdAt) <= Date.parse(input.to)));
  let offset = 0;
  if (cursor) {
    const previous = matches.findIndex((log) => `demo_${log.id}` === cursor);
    if (previous < 0) throw new Error('This demo cursor is no longer valid. Refresh the log list.');
    offset = previous + 1;
  }
  const limit = input.limit ?? 50;
  const items = matches.slice(offset, offset + limit);
  const hasMore = offset + limit < matches.length;
  const last = items.at(-1);
  return structuredClone({ items, pagination: { limit, hasMore, nextCursor: hasMore && last ? `demo_${last.id}` : null } });
}

export function createDemoProject(input: { name: string }): CreatedProject {
  const { name } = createProjectSchema.parse(input);
  const timestamp = new Date().toISOString();
  // This explicitly marked demo key is an example and cannot ingest into the live API.
  const apiKey = `lmd_demo_${crypto.randomUUID().replaceAll('-', '')}${'0'.repeat(6)}`;
  const project: Project = { id: crypto.randomUUID(), name, apiKeyPrefix: apiKey.slice(0, 12), createdAt: timestamp, updatedAt: timestamp };
  projects.unshift(project);
  return { project: structuredClone(project), apiKey };
}
