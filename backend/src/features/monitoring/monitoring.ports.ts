import type { MonitorCheck, MonitorSummary, ProbeResult } from './monitoring.types.js';

export interface AvailabilityProbe {
  readonly configured: boolean;
  readonly connectAddress: string | null;
  check(signal?: AbortSignal): Promise<ProbeResult>;
}
export interface MonitoringRepository {
  save(input: ProbeResult): Promise<MonitorCheck>;
  latest(): Promise<MonitorCheck | null>;
  history(limit: number): Promise<MonitorCheck[]>;
  summary(since: Date): Promise<MonitorSummary>;
}
