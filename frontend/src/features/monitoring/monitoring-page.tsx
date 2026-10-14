import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, ArrowRight, ArrowUpRight, CheckCircle2, Clock3, Globe2, LockKeyhole, RefreshCw, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/stores/auth-store';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { MonitorStatus } from './monitoring.models';

const statusLabels: Record<MonitorStatus, string> = {
  UP: 'Available', DEGRADED: 'Unexpected response', DOWN: 'Unavailable', RESTRICTED: 'Access restricted', TIMEOUT: 'Timed out',
};
export function MonitoringPage({ onConnect }: { onConnect: () => void }) {
  const { mode, user, sessionGeneration } = useAuthStore();
  const client = useQueryClient();
  const key = ['ceir-monitor', mode, user?.id ?? 'anonymous', sessionGeneration];
  const connected = mode === 'live' && user !== null;
  const query = useQuery({
    queryKey: key, queryFn: ({ signal }) => api.getCeirMonitor(signal),
    enabled: connected, refetchInterval: 15_000, refetchIntervalInBackground: false,
    retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 1,
  });
  const check = useMutation({
    mutationKey: ['ceir-check', mode, user?.id, sessionGeneration],
    mutationFn: api.checkCeirMonitor,
    onSuccess: (data) => { client.setQueryData(key, data); toast.success('Latest monitor result loaded'); },
    onError: (error) => toast.error(error.message), retry: false,
  });
  if (!connected) return <section className="panel monitor-connect"><div className="monitor-connect-icon"><LockKeyhole size={25} /></div><h2>Your CEIR monitor is ready to connect.</h2><p>Sign in to your Logline account to view the live availability checks. Monitoring credentials stay on the backend; demo mode does not show invented CEIR results.</p><Button onClick={onConnect}>Connect your workspace <ArrowRight size={15} /></Button></section>;
  if (query.isPending) return <section className="panel monitor-loading" role="status"><RefreshCw size={20} className="animate-spin" /><p>Loading CEIR availability…</p></section>;
  if (query.isError && !query.data) return <section className="error-panel" role="alert"><Globe2 size={20} /><div><strong>Unable to load the monitor</strong><p>{query.error.message}</p></div><Button variant="outline" onClick={() => { void query.refetch(); }}>Try again</Button></section>;
  const data = query.data;
  if (!data) return null;
  const status = data.latest?.status;
  const history = [...data.history].reverse();
  const formatTime = (time: string) => new Date(time).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });

  return <div className="monitor-page">
    <section className="panel monitor-target"><div className="monitor-target-icon"><Globe2 size={25} /></div><div className="monitor-target-copy"><div className="monitor-target-title"><h2>{data.monitor.name}</h2><span className={cn('monitor-status', `monitor-status-${status?.toLowerCase() ?? 'unknown'}`)}><i />{!data.monitor.configured ? 'Not configured' : status ? statusLabels[status] : 'Waiting for first check'}</span></div><a href={data.monitor.url} target="_blank" rel="noreferrer">{data.monitor.method} {data.monitor.url}<ArrowUpRight size={13} /></a><p>{data.latest?.reason ?? 'The first background check will appear here shortly.'}</p></div><Button disabled={!data.monitor.configured || check.isPending} onClick={() => check.mutate()}><RefreshCw size={15} className={cn(check.isPending && 'animate-spin')} />{check.isPending ? 'Checking…' : 'Check now'}</Button></section>
    {!data.monitor.configured && <div className="error-panel" role="alert"><LockKeyhole size={20} /><p>Configure SWAGGER_USER and SWAGGER_PASSWORD in the backend environment, then restart the backend.</p></div>}
    {query.isError && <div className="error-panel" role="alert"><p>Showing the last loaded result. {query.error.message}</p></div>}
    <section className="stats-grid monitor-stats" aria-label="Recorded CEIR check statistics"><article className="stat-card"><div className="stat-title">Latest HTTP status <Globe2 size={16} /></div><strong className="monitor-stat-value">{data.latest?.httpStatus ?? '—'}</strong><p>{data.latest ? formatTime(data.latest.checkedAt) : 'No check recorded yet'}</p></article><article className="stat-card"><div className="stat-title">Last check duration <Clock3 size={16} /></div><strong className="monitor-stat-value">{data.latest?.responseTimeMs ?? '—'}<small> ms</small></strong><p>Includes connection and response time</p></article><article className="stat-card"><div className="stat-title">Successful checks <CheckCircle2 size={16} /></div><strong className="monitor-stat-value">{data.summary.successRatePercent ?? '—'}<small>{data.summary.successRatePercent === null ? '' : '%'}</small></strong><p>{data.summary.successfulChecks} of {data.summary.totalChecks} recorded in 24 hours</p></article><article className="stat-card"><div className="stat-title">Average check duration <Activity size={16} /></div><strong className="monitor-stat-value">{data.summary.averageResponseTimeMs ?? '—'}<small> ms</small></strong><p>Average across recorded 24-hour checks</p></article></section>
    <section className="panel monitor-timeline"><div className="panel-header"><div><h2>Availability history</h2><p>Most recent {data.history.length} recorded checks</p></div><span>Every {data.monitor.intervalSeconds} seconds</span></div><div className="monitor-timeline-bars">{history.length ? history.map((item) => <span key={item.id} className={cn('monitor-timeline-bar', `monitor-bar-${item.status.toLowerCase()}`)} title={`${formatTime(item.checkedAt)} · ${statusLabels[item.status]} · ${item.responseTimeMs} ms`} />) : <p>No checks recorded yet.</p>}</div><div className="monitor-timeline-legend"><span><i className="monitor-bar-up" /> Available</span><span><i className="monitor-bar-degraded" /> Unexpected response</span><span><i className="monitor-bar-down" /> Unavailable / timeout</span><span><i className="monitor-bar-restricted" /> Restricted</span></div><div className="chart-footer"><span>Background checks continue when the dashboard is closed.</span><span>Manual checks share a 30-second cooldown.</span></div></section>
    <section className="panel monitor-history"><div className="panel-header"><h2>Recent checks</h2><span className="count-badge">{data.history.length}</span></div><div className="monitor-history-scroll"><table><thead><tr><th>Checked at</th><th>Result</th><th>HTTP</th><th>Duration</th><th>Details</th></tr></thead><tbody>{data.history.map((item) => <tr key={item.id}><td><time dateTime={item.checkedAt}>{formatTime(item.checkedAt)}</time></td><td><span className={cn('monitor-status', `monitor-status-${item.status.toLowerCase()}`)}><i />{statusLabels[item.status]}</span></td><td>{item.httpStatus ?? '—'}</td><td>{item.responseTimeMs} ms</td><td>{item.reason}</td></tr>)}</tbody></table></div>{!data.history.length && <div className="empty-state"><p>Waiting for the first background check.</p></div>}</section>
    <section className="monitor-scope"><ShieldCheck size={19} /><div><strong>What this monitor verifies</strong><p>{data.monitor.scope} Swagger credentials do not authorize business endpoints, which require a separate API JWT. Successful-check percentage measures recorded samples, rather than continuous uptime.</p></div></section>
  </div>;
}
