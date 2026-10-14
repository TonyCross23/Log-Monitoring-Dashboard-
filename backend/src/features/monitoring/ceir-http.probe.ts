import { performance } from 'node:perf_hooks';
import type { CeirMonitoringConfig } from '../../config/config.types.js';
import type { AvailabilityProbe } from './monitoring.ports.js';
import { CEIR_MONITOR_URL, type ProbeResult } from './monitoring.types.js';

type Fetch = typeof globalThis.fetch;
const MAX_BODY_BYTES = 65_536;

/** Fixed host/path prevents this credentialed probe from becoming an arbitrary URL proxy. */
export class CeirHttpProbe implements AvailabilityProbe {
  readonly configured: boolean;
  constructor(private readonly config: CeirMonitoringConfig | undefined, private readonly request: Fetch = globalThis.fetch) {
    this.configured = config !== undefined;
  }

  async check(signal?: AbortSignal): Promise<ProbeResult> {
    if (!this.config) throw new Error('CEIR monitoring credentials are not configured');
    const checkedAt = new Date();
    const start = performance.now();
    const timeout = AbortSignal.timeout(this.config.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let httpStatus: number | null = null;
    const result = (status: ProbeResult['status'], reason: string): ProbeResult => ({
      status, reason, httpStatus, checkedAt,
      responseTimeMs: Math.max(0, Math.round(performance.now() - start)),
    });
    try {
      const response = await this.request(CEIR_MONITOR_URL, {
        method: 'GET', redirect: 'manual', signal: combined,
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.config.swaggerUser}:${this.config.swaggerPassword}`).toString('base64')}`,
          Accept: 'text/html', 'User-Agent': 'Logline-Availability-Monitor/1.0',
        },
      });
      httpStatus = response.status;
      if (!response.ok) {
        await response.body?.cancel();
        if ([401, 403].includes(httpStatus)) return result('RESTRICTED', 'The endpoint denied access. Verify Swagger credentials or upstream access rules.');
        if (httpStatus >= 500) return result('DOWN', 'The remote endpoint returned a server error.');
        if (httpStatus >= 300 && httpStatus < 400) return result('DEGRADED', 'The endpoint redirected. Redirects are not followed with credentials.');
        return result('DEGRADED', httpStatus === 429 ? 'The remote endpoint rate limited the check.' : 'The endpoint returned an unexpected HTTP status.');
      }
      if (!response.headers.get('content-type')?.toLowerCase().includes('text/html')) {
        await response.body?.cancel();
        return result('DEGRADED', 'The endpoint did not return the expected Swagger HTML.');
      }
      const reader = response.body?.getReader();
      if (!reader) return result('DEGRADED', 'The endpoint returned an empty response.');
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > MAX_BODY_BYTES) {
            await reader.cancel();
            return result('DEGRADED', 'The response exceeded the bounded Swagger check size.');
          }
          chunks.push(chunk.value);
        }
      } finally { reader.releaseLock(); }
      const html = Buffer.concat(chunks).toString('utf8');
      return /id=["']swagger-ui["']/.test(html)
        ? result('UP', 'Authenticated Swagger endpoint responded successfully.')
        : result('DEGRADED', 'The endpoint returned HTML without the expected Swagger marker.');
    } catch {
      // Never persist upstream bodies, fetch exceptions, or Authorization headers.
      if (timeout.aborted) return result('TIMEOUT', 'The remote endpoint did not respond within the configured timeout.');
      if (signal?.aborted) throw new Error('Monitoring check canceled');
      return result('DOWN', 'Unable to reach the remote endpoint. Check network, DNS, or TLS connectivity.');
    }
  }
}
