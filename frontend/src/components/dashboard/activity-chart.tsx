import { useState } from 'react';
import { cn } from '@/lib/utils';
import type { LogEntry } from '@/lib/models';

export function ActivityChart({ logs, from, to }: { logs: LogEntry[]; from: number; to: number }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const buckets = Array.from({ length: 24 }, (_, index) => {
    const start = from + ((to - from) / 24) * index;
    const end = from + ((to - from) / 24) * (index + 1);
    const events = logs.filter((log) => new Date(log.createdAt).getTime() >= start && new Date(log.createdAt).getTime() < end);
    return { time: start, total: events.length, errors: events.filter((log) => ['ERROR', 'FATAL'].includes(log.level)).length };
  });
  const width = 800;
  const height = 180;
  const max = Math.max(4, ...buckets.map((bucket) => bucket.total));
  const points = buckets.map((bucket, index) => ({ x: (index / 23) * width, y: height - (bucket.total / max) * (height - 22) }));
  const line = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
  const area = `${line} L ${width} ${height} L 0 ${height} Z`;
  const bucket = hovered === null ? undefined : buckets[hovered];
  const point = hovered === null ? undefined : points[hovered];
  const timeLabel = (time: number) => new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

  return <div className="chart-wrap">
    <div className="chart-y-labels" aria-hidden="true">{[max, Math.round(max * 0.75), Math.round(max * 0.5), Math.round(max * 0.25), 0].map((value, index) => <span key={index}>{value}</span>)}</div>
    <div className="chart-plot">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Loaded log volume across 24 time buckets, ${logs.length} events in this view`} preserveAspectRatio="none" onMouseMove={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        setHovered(Math.min(23, Math.max(0, Math.round(((event.clientX - bounds.left) / bounds.width) * 23))));
      }} onMouseLeave={() => setHovered(null)}>
        <defs><linearGradient id="volume-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#13a97e" stopOpacity="0.23" /><stop offset="100%" stopColor="#13a97e" stopOpacity="0.01" /></linearGradient></defs>
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => <line key={ratio} x1="0" x2={width} y1={ratio * height} y2={ratio * height} stroke="#e8ece9" strokeDasharray="4 5" />)}
        <path d={area} fill="url(#volume-fill)" />
        <path d={line} fill="none" stroke="#129b73" strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        {point && <><line x1={point.x} x2={point.x} y1="0" y2={height} stroke="#86cbb5" strokeDasharray="4 3" /><circle cx={point.x} cy={point.y} r="4" fill="#fff" stroke="#129b73" strokeWidth="2.5" /></>}
      </svg>
      {bucket && <div className={cn('chart-tooltip', hovered !== null && hovered > 15 && 'chart-tooltip-left')} style={{ left: `${((hovered ?? 0) / 23) * 100}%` }}><strong>{timeLabel(bucket.time)}</strong><span><i />{bucket.total} logs · {bucket.errors} errors</span></div>}
      <div className="chart-x-labels" aria-hidden="true">{[0, 4, 8, 12, 16, 20, 23].map((index) => <span key={index}>{timeLabel(buckets[index]?.time ?? from)}</span>)}</div>
    </div>
  </div>;
}
