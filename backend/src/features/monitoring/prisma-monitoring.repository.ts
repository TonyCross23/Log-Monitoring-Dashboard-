import type { PrismaClient } from '../../generated/prisma/client.js';
import type { MonitoringRepository } from './monitoring.ports.js';
import { CEIR_MONITOR_KEY, type MonitorCheck, type MonitorSummary, type ProbeResult } from './monitoring.types.js';

export class PrismaMonitoringRepository implements MonitoringRepository {
  constructor(private readonly prisma: PrismaClient) {}
  save(input: ProbeResult): Promise<MonitorCheck> {
    return this.prisma.apiMonitorCheck.create({ data: { ...input, monitorKey: CEIR_MONITOR_KEY } });
  }
  latest(): Promise<MonitorCheck | null> {
    return this.prisma.apiMonitorCheck.findFirst({ where: { monitorKey: CEIR_MONITOR_KEY }, orderBy: [{ checkedAt: 'desc' }, { id: 'desc' }] });
  }
  history(limit: number): Promise<MonitorCheck[]> {
    return this.prisma.apiMonitorCheck.findMany({ where: { monitorKey: CEIR_MONITOR_KEY }, orderBy: [{ checkedAt: 'desc' }, { id: 'desc' }], take: limit });
  }
  async summary(since: Date): Promise<MonitorSummary> {
    const where = { monitorKey: CEIR_MONITOR_KEY, checkedAt: { gte: since } };
    const [aggregate, successfulChecks] = await Promise.all([
      this.prisma.apiMonitorCheck.aggregate({ where, _count: { _all: true }, _avg: { responseTimeMs: true } }),
      this.prisma.apiMonitorCheck.count({ where: { ...where, status: 'UP' } }),
    ]);
    return {
      totalChecks: aggregate._count._all, successfulChecks,
      averageResponseTimeMs: aggregate._avg.responseTimeMs === null ? null : Math.round(aggregate._avg.responseTimeMs),
    };
  }
}
