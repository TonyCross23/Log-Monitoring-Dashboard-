import { useEffect, useId, useState, type FormEvent } from 'react';
import { Check, Copy, FolderPlus, KeyRound, LoaderCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useCreateProject } from '@/features/data/use-dashboard';
import { createProjectSchema, type CreatedProject } from '@/lib/models';
import { useAuthStore } from '@/stores/auth-store';
import { useUIStore } from '@/stores/ui-store';

interface CreateProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateProjectDialog({ open, onOpenChange }: CreateProjectDialogProps) {
  const id = useId();
  const mode = useAuthStore((state) => state.mode);
  const sessionGeneration = useAuthStore((state) => state.sessionGeneration);
  const mutation = useCreateProject();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedProject | null>(null);
  const [copied, setCopied] = useState(false);
  const resetMutation = mutation.reset;

  useEffect(() => {
    if (!open) {
      setCreated(null);
      setName('');
      setError(null);
      setFieldError(null);
      setCopied(false);
      resetMutation();
    }
  }, [open, resetMutation]);

  useEffect(() => {
    setCreated(null);
    setName('');
    setError(null);
    setFieldError(null);
    setCopied(false);
    resetMutation();
  }, [sessionGeneration, resetMutation]);

  function handleOpenChange(nextOpen: boolean) {
    if (mutation.isPending) return;
    if (!nextOpen) {
      // The secret is revealed once and never written to storage or project queries.
      setCreated(null);
      setName('');
      setError(null);
      setFieldError(null);
      setCopied(false);
      mutation.reset();
    }
    onOpenChange(nextOpen);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mutation.isPending) return;
    const result = createProjectSchema.safeParse({ name });
    if (!result.success) {
      setFieldError(result.error.issues[0]?.message ?? 'Enter a project name.');
      return;
    }
    setFieldError(null);
    setError(null);
    try {
      const project = await mutation.mutateAsync(result.data);
      setCreated(project);
      useUIStore.getState().setProject(project.project.id);
      useUIStore.getState().setView('logs');
      toast.success('Project created.');
    } catch (failure: unknown) {
      setError(failure instanceof Error ? failure.message : 'Unable to create your project. Please try again.');
    }
  }

  async function copyApiKey() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.apiKey);
      setCopied(true);
      toast.success('API key copied.');
    } catch {
      toast.error('Clipboard unavailable. Select and copy the key below.');
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent showCloseButton={!mutation.isPending}>
        <div className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">{created ? <KeyRound className="size-5" aria-hidden="true" /> : <FolderPlus className="size-5" aria-hidden="true" />}</div>
        <DialogHeader>
          <DialogTitle>{created ? 'Your project is ready' : 'Create a project'}</DialogTitle>
          <DialogDescription>{created ? `Connect ${created.project.name} to start collecting logs.` : 'Give your application a home. Each project gets its own ingestion key.'}</DialogDescription>
        </DialogHeader>
        {created ? (
          <>
            <div className="space-y-2">
              <label htmlFor={`${id}-api-key`} className="text-sm font-medium">{mode === 'demo' ? 'Demo API key' : 'Project API key'}</label>
              <div className="relative">
                <textarea id={`${id}-api-key`} aria-label="Project API key, shown once" readOnly value={created.apiKey} rows={2} className="w-full resize-none rounded-lg border border-input bg-secondary/50 p-3 pr-12 font-mono text-xs leading-6 outline-none focus-visible:ring-2 focus-visible:ring-ring" onFocus={(event) => event.target.select()} />
                <Button type="button" variant="ghost" size="icon" className="absolute right-1 top-1" aria-label="Copy project API key" onClick={() => { void copyApiKey(); }}>{copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}</Button>
              </div>
              <p className="text-xs leading-relaxed text-amber-700">{mode === 'demo' ? 'This example key is for the demo workspace. Create a live project to receive an ingestion key.' : 'Save this key somewhere secure. It will not be available again after closing this dialog.'}</p>
            </div>
            <div className="rounded-lg border border-border bg-secondary/30 p-3 text-xs leading-relaxed text-muted-foreground">Send logs to <code className="font-mono text-foreground">POST /api/v1/logs</code> with the <code className="font-mono text-foreground">x-api-key</code> header.</div>
            <DialogFooter><Button type="button" onClick={() => handleOpenChange(false)}>Go to project</Button></DialogFooter>
          </>
        ) : (
          <form onSubmit={(event) => { void handleSubmit(event); }} noValidate className="space-y-5">
            <div className="space-y-2">
              <label htmlFor={`${id}-name`} className="text-sm font-medium">Project name</label>
              <Input id={`${id}-name`} autoFocus name="name" placeholder="e.g. Payments API" value={name} onChange={(event) => { setName(event.target.value); setFieldError(null); setError(null); }} maxLength={100} disabled={mutation.isPending} aria-invalid={Boolean(fieldError)} aria-describedby={fieldError ? `${id}-name-error` : `${id}-name-help`} />
              {fieldError ? <p id={`${id}-name-error`} className="text-xs text-destructive">{fieldError}</p> : <p id={`${id}-name-help`} className="text-xs text-muted-foreground">Choose a name your team will recognize.</p>}
            </div>
            {error && <p role="alert" className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
            {mode === 'demo' && <p className="text-xs text-muted-foreground">You are in the demo workspace. This project stays in your current browser session.</p>}
            <DialogFooter>
              <Button type="button" variant="outline" disabled={mutation.isPending} onClick={() => handleOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={mutation.isPending}>{mutation.isPending && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}{mutation.isPending ? 'Creating…' : 'Create project'}</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
