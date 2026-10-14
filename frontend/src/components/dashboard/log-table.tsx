import { ArrowUpRight, ChevronRight, FileSearch } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { LogEntry, LogLevel } from '@/lib/models';
import { Button } from '@/components/ui/button';

export function LevelBadge({ level }: { level: LogLevel }) {
  return <span className={cn('level-badge', `level-${level.toLowerCase()}`)}><i />{level}</span>;
}

export function LogTable({ logs, onSelect, compact = false, loading = false }: {
  logs: LogEntry[]; onSelect: (log: LogEntry) => void; compact?: boolean; loading?: boolean;
}) {
  if (loading) return <div className="loading-rows" role="status" aria-label="Loading logs">{Array.from({ length: 6 }, (_, index) => <div className="skeleton-row" key={index}><span /><span /><span /></div>)}</div>;
  if (!logs.length) return <div className="empty-state"><div className="empty-icon"><FileSearch size={24} /></div><h3>No logs in this view</h3><p>Try a wider time range or clear your filters.<br />New events will appear here when they arrive.</p></div>;
  return <><div className="log-table-wrap desktop-log-table"><table className={cn('log-table', compact && 'compact-log-table')}>
    <thead><tr><th>LEVEL</th><th>TIMESTAMP <span>↓</span></th><th>MESSAGE</th><th className="source-column">SOURCE</th><th><span className="sr-only">Open log details</span></th></tr></thead>
    <tbody>{logs.map((log) => {
      const source = typeof log.metadata?.service === 'string' ? log.metadata.service : 'application';
      return <tr key={log.id} className={cn(['ERROR', 'FATAL'].includes(log.level) && 'error-row')} onClick={() => onSelect(log)}>
        <td><LevelBadge level={log.level} /></td>
        <td className="timestamp-cell"><time dateTime={log.createdAt}>{new Date(log.createdAt).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}<span>.{String(new Date(log.createdAt).getMilliseconds()).padStart(3, '0')}</span></time></td>
        <td className="message-cell"><button onClick={(event) => { event.stopPropagation(); onSelect(log); }}>{log.message}</button></td>
        <td className="source-column"><span className="source-tag">{source}</span></td>
        <td className="log-row-arrow"><button aria-label={`View ${log.level.toLowerCase()} log details`} onClick={(event) => { event.stopPropagation(); onSelect(log); }}><ChevronRight size={15} /></button></td>
      </tr>;
    })}</tbody>
  </table></div><div className="mobile-log-list">{logs.map((log) => <button key={log.id} className={cn('mobile-log-row', ['ERROR', 'FATAL'].includes(log.level) && 'mobile-log-error')} onClick={() => onSelect(log)}>
    <span className="mobile-log-meta"><LevelBadge level={log.level} /><time dateTime={log.createdAt}>{new Date(log.createdAt).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time><ChevronRight size={14} /></span>
    <span className="mobile-log-message">{log.message}</span>
    <span className="mobile-log-source">{typeof log.metadata?.service === 'string' ? log.metadata.service : 'application'}</span>
  </button>)}</div></>;
}

export function RecentLogsHeader({ count, onViewAll }: { count: number; onViewAll: () => void }) {
  return <div className="panel-header"><div className="panel-heading"><h2>Recent logs</h2><span className="count-badge">{count}</span></div><Button variant="ghost" size="sm" onClick={onViewAll}>View all logs <ArrowUpRight size={15} /></Button></div>;
}
