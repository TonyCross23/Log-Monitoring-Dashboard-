import { Copy } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import type { LogEntry, LogLevel } from '@/lib/models';
import { cn } from '@/lib/utils';

interface LogDetailProps {
  log: LogEntry | null;
  onClose: () => void;
}

const levelClasses: Record<LogLevel, string> = {
  TRACE: 'border-slate-200 bg-slate-50 text-slate-600',
  DEBUG: 'border-violet-200 bg-violet-50 text-violet-600',
  INFO: 'border-sky-200 bg-sky-50 text-sky-700',
  WARN: 'border-amber-200 bg-amber-50 text-amber-700',
  ERROR: 'border-rose-200 bg-rose-50 text-rose-700',
  FATAL: 'border-red-200 bg-red-100 text-red-800',
};

export function LogDetail({ log, onClose }: LogDetailProps) {
  async function copyPayload() {
    if (!log) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(log, null, 2));
      toast.success('Log payload copied.');
    } catch {
      toast.error('Clipboard unavailable. Please select the log content to copy it.');
    }
  }

  return (
    <Sheet open={Boolean(log)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent className="sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Log details</SheetTitle>
          <SheetDescription>Inspect the event, its context, and the original stack trace.</SheetDescription>
        </SheetHeader>
        {log && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-5">
              <Badge variant="outline" className={cn('font-mono', levelClasses[log.level])}><span className="size-1.5 rounded-full bg-current" aria-hidden="true" />{log.level}</Badge>
              <Button variant="outline" size="sm" onClick={() => { void copyPayload(); }}><Copy className="size-3.5" aria-hidden="true" />Copy JSON</Button>
            </div>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-3 text-sm">
              <dt className="text-muted-foreground">Timestamp</dt><dd><time dateTime={log.createdAt}>{new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'long' }).format(new Date(log.createdAt))}</time></dd>
              <dt className="text-muted-foreground">Event ID</dt><dd className="break-all font-mono text-xs leading-5">{log.id}</dd>
              <dt className="text-muted-foreground">Project ID</dt><dd className="break-all font-mono text-xs leading-5">{log.projectId}</dd>
            </dl>
            <section className="space-y-2" aria-labelledby="log-message-title">
              <h3 id="log-message-title" className="text-sm font-semibold">Message</h3>
              <p className="whitespace-pre-wrap break-words rounded-lg border border-border bg-secondary/30 p-4 font-mono text-xs leading-6">{log.message || 'No message'}</p>
            </section>
            <section className="space-y-2" aria-labelledby="log-stack-title">
              <h3 id="log-stack-title" className="text-sm font-semibold">Stack trace</h3>
              {log.stackTrace ? <pre tabIndex={0} className="max-h-72 overflow-auto rounded-lg bg-slate-950 p-4 font-mono text-xs leading-6 text-slate-200 outline-none focus-visible:ring-2 focus-visible:ring-ring"><code>{log.stackTrace}</code></pre> : <p className="text-sm text-muted-foreground">No stack trace was attached to this event.</p>}
            </section>
            <section className="space-y-2" aria-labelledby="log-metadata-title">
              <h3 id="log-metadata-title" className="text-sm font-semibold">Metadata</h3>
              {log.metadata ? <pre tabIndex={0} className="max-h-80 overflow-auto rounded-lg border border-border bg-secondary/30 p-4 font-mono text-xs leading-6 outline-none focus-visible:ring-2 focus-visible:ring-ring"><code>{JSON.stringify(log.metadata, null, 2)}</code></pre> : <p className="text-sm text-muted-foreground">No metadata was attached to this event.</p>}
            </section>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
