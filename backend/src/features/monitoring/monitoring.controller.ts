import type { RequestHandler } from 'express';
import type { MonitoringService } from './monitoring.service.js';
import { emptyMonitorInputSchema as empty, monitorQuerySchema as query } from './monitoring.schemas.js';
export class MonitoringController {
  constructor(private readonly service: MonitoringService) {}
  readonly read: RequestHandler = async (request, response) => {
    empty.parse(request.params);
    const input = query.parse(request.query);
    response.json({ data: await this.service.dashboard(input.limit) });
  };
  readonly check: RequestHandler = async (request, response) => {
    empty.parse(request.params); empty.parse(request.query); empty.parse(request.body);
    await this.service.checkNow();
    response.json({ data: await this.service.dashboard() });
  };
}
