import type { Logger } from 'pino';
import type { MonitoringService } from './monitoring.service.js';

/** Started only by the server entry point, never by test/application construction. */
export function startMonitoring(service: MonitoringService, logger: Logger): () => void {
  if (!service.configured) return () => {};
  const abort = new AbortController();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tick = async () => {
    try { await service.checkNow(abort.signal); }
    catch { if (!stopped) logger.error('CEIR availability check could not be recorded'); }
    if (!stopped) {
      timer = setTimeout(() => { void tick(); }, service.intervalSeconds * 1000);
      timer.unref();
    }
  };
  void tick();
  return () => { stopped = true; abort.abort(); if (timer) clearTimeout(timer); };
}
