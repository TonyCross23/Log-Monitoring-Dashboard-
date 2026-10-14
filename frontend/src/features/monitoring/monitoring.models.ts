import { z } from 'zod';

export const monitorStatusSchema = z.enum(['UP', 'DEGRADED', 'DOWN', 'RESTRICTED', 'TIMEOUT']);
export const monitorCheckSchema = z.object({
  id: z.uuid(), monitorKey: z.literal('ceir-swagger'), status: monitorStatusSchema,
  httpStatus: z.number().int().min(100).max(599).nullable(),
  responseTimeMs: z.number().int().nonnegative(), checkedAt: z.iso.datetime(), reason: z.string(),
});
export const monitorDashboardSchema = z.object({
  monitor: z.object({
    id: z.literal('ceir-swagger'), name: z.string(), url: z.url(), method: z.literal('GET'),
    configured: z.boolean(), intervalSeconds: z.number().int().min(30), scope: z.string(),
  }),
  latest: monitorCheckSchema.nullable(), history: z.array(monitorCheckSchema).max(100),
  summary: z.object({
    totalChecks: z.number().int().nonnegative(), successfulChecks: z.number().int().nonnegative(),
    averageResponseTimeMs: z.number().int().nonnegative().nullable(), since: z.iso.datetime(),
    successRatePercent: z.number().min(0).max(100).nullable(),
  }),
  nextCheckAt: z.iso.datetime().nullable(),
});
export type MonitorStatus = z.infer<typeof monitorStatusSchema>;
export type MonitorDashboard = z.infer<typeof monitorDashboardSchema>;
