export const CEIR_MONITOR_KEY = 'ceir-health';
export const CEIR_MONITOR_HOSTNAME = 'apidocx.eastwindmyanmar.com.mm';
export const CEIR_MONITOR_URL = `https://${CEIR_MONITOR_HOSTNAME}/health`;

export interface MonitorComponent {
  name: string;
  status: 'UP' | 'DOWN' | 'UNKNOWN';
  latencyMs: number | null;
}

export type MonitorStatus = 'UP' | 'DEGRADED' | 'DOWN' | 'RESTRICTED' | 'TIMEOUT';
export interface ProbeResult {
  status: MonitorStatus;
  httpStatus: number | null;
  responseTimeMs: number;
  checkedAt: Date;
  reason: string;
  components: MonitorComponent[];
}
export interface MonitorCheck extends ProbeResult { id: string; monitorKey: string }
export interface MonitorSummary {
  totalChecks: number;
  successfulChecks: number;
  averageResponseTimeMs: number | null;
}
export interface MonitorDashboard {
  monitor: {
    id: string;
    name: string;
    url: string;
    connectAddress: string | null;
    method: 'GET';
    configured: boolean;
    intervalSeconds: number;
    scope: string;
  };
  latest: MonitorCheck | null;
  history: MonitorCheck[];
  summary: MonitorSummary & { since: Date; successRatePercent: number | null };
  nextCheckAt: Date | null;
}
