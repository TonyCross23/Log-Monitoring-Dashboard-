import { AppError } from '../../shared/errors/app-error.js';
import type { AvailabilityProbe, MonitoringRepository } from './monitoring.ports.js';
import { CEIR_MONITOR_KEY, CEIR_MONITOR_URL, type MonitorCheck, type MonitorDashboard } from './monitoring.types.js';

export class MonitoringService {
  private inFlight: Promise<MonitorCheck> | null = null;
  private lastCheckStartedAt: number | null = null;
  private lastRecordedCheck: MonitorCheck | null = null;
  constructor(
    private readonly repository: MonitoringRepository,
    private readonly probe: AvailabilityProbe,
    public readonly intervalSeconds = 60,
    private readonly now: () => number = Date.now,
  ) {}
  get configured(): boolean { return this.probe.configured; }

  async dashboard(limit = 60): Promise<MonitorDashboard> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new AppError(400, 'INVALID_LIMIT', 'History limit must be between 1 and 100');
    const since = new Date(this.now() - 86_400_000);
    const [latest, history, summary] = await Promise.all([
      this.repository.latest(), this.repository.history(limit), this.repository.summary(since),
    ]);
    return {
      monitor: {
        id: CEIR_MONITOR_KEY, name: 'CEIR API health', url: CEIR_MONITOR_URL, method: 'GET', connectAddress: this.probe.connectAddress,
        configured: this.configured, intervalSeconds: this.intervalSeconds,
        scope: 'Verified HTTPS GET /health and its reported RabbitMQ/service checks. Business transactions and unreported database dependencies are not tested.',
      },
      latest, history, summary: {
        ...summary, since,
        successRatePercent: summary.totalChecks === 0 ? null : Math.round((summary.successfulChecks / summary.totalChecks) * 1000) / 10,
      },
      nextCheckAt: this.configured && latest ? new Date(latest.checkedAt.getTime() + this.intervalSeconds * 1000) : null,
    };
  }

  checkNow(signal?: AbortSignal): Promise<MonitorCheck> {
    if (!this.configured) throw new AppError(503, 'MONITOR_NOT_CONFIGURED', 'Enable CEIR monitoring in the backend environment');
    if (this.inFlight) return this.inFlight;
    // Shared cooldown prevents manual clicks/users from flooding the remote API.
    if (this.lastCheckStartedAt !== null && this.now() - this.lastCheckStartedAt < 30_000) {
      if (this.lastRecordedCheck) return Promise.resolve(this.lastRecordedCheck);
      throw new AppError(429, 'MONITOR_COOLDOWN', 'Wait before retrying this monitor check');
    }
    this.lastCheckStartedAt = this.now();
    const pending = this.probe.check(signal).then((result) => this.repository.save(result)).then((record) => {
      this.lastRecordedCheck = record;
      return record;
    }).finally(() => { if (this.inFlight === pending) this.inFlight = null; });
    this.inFlight = pending;
    return pending;
  }
}
