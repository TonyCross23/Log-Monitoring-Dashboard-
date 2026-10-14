import { useEffect, useId, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, LoaderCircle, Terminal } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { loginSchema, registerSchema } from '@/lib/models';
import { cn } from '@/lib/utils';
import { useUIStore } from '@/stores/ui-store';

interface AuthDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type FieldName = 'name' | 'email' | 'password';
type FieldErrors = Partial<Record<FieldName, string>>;

export function AuthDialog({ open, onOpenChange }: AuthDialogProps) {
  const id = useId();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [values, setValues] = useState({ name: '', email: '', password: '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isRegister = mode === 'register';

  useEffect(() => {
    if (!open) {
      setValues({ name: '', email: '', password: '' });
      setErrors({});
      setError(null);
    }
  }, [open]);

  function handleOpenChange(nextOpen: boolean) {
    if (busy) return;
    if (!nextOpen) {
      setValues({ name: '', email: '', password: '' });
      setErrors({});
      setError(null);
    }
    onOpenChange(nextOpen);
  }

  function updateField(field: FieldName, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError(null);
    const payload = isRegister ? values : { email: values.email, password: values.password };
    const result = (isRegister ? registerSchema : loginSchema).safeParse(payload);
    if (!result.success) {
      const nextErrors: FieldErrors = {};
      for (const issue of result.error.issues) {
        const field = issue.path[0];
        if ((field === 'name' || field === 'email' || field === 'password') && !nextErrors[field]) nextErrors[field] = issue.message;
      }
      setErrors(nextErrors);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      if (isRegister) await api.register(registerSchema.parse(values));
      await api.login(loginSchema.parse({ email: values.email, password: values.password }));
      // Account changes discard the previous user's project and log responses.
      queryClient.clear();
      useUIStore.getState().setProject('');
      useUIStore.getState().setView('overview');
      setValues({ name: '', email: '', password: '' });
      onOpenChange(false);
      toast.success(isRegister ? 'Your workspace is ready.' : 'Welcome back.');
    } catch (failure: unknown) {
      setError(failure instanceof Error ? failure.message : 'Unable to sign in. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent showCloseButton={!busy}>
        <div className="mb-1 flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary"><Terminal className="size-6" aria-hidden="true" /></div>
        <DialogHeader>
          <DialogTitle>{isRegister ? 'Create your workspace' : 'Welcome back'}</DialogTitle>
          <DialogDescription>{isRegister ? 'Start monitoring your applications in one place.' : 'Sign in to connect your projects and explore their logs.'}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-secondary p-1" role="group" aria-label="Account action">
          {(['login', 'register'] as const).map((action) => (
            <button key={action} type="button" aria-pressed={mode === action} disabled={busy} className={cn('rounded-md px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50', mode === action ? 'bg-background font-medium text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground')} onClick={() => { setMode(action); setErrors({}); setError(null); }}>
              {action === 'login' ? 'Sign in' : 'Create account'}
            </button>
          ))}
        </div>
        <form onSubmit={(event) => { void handleSubmit(event); }} noValidate className="space-y-4">
          {isRegister && (
            <div className="space-y-1.5">
              <label htmlFor={`${id}-name`} className="text-sm font-medium">Your name</label>
              <Input id={`${id}-name`} name="name" value={values.name} onChange={(event) => updateField('name', event.target.value)} placeholder="Maya Chen" autoComplete="name" disabled={busy} maxLength={100} aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? `${id}-name-error` : undefined} autoFocus />
              {errors.name && <p id={`${id}-name-error`} className="text-xs text-destructive">{errors.name}</p>}
            </div>
          )}
          <div className="space-y-1.5">
            <label htmlFor={`${id}-email`} className="text-sm font-medium">Email address</label>
            <Input id={`${id}-email`} name="email" type="email" value={values.email} onChange={(event) => updateField('email', event.target.value)} placeholder="you@company.com" autoComplete="email" disabled={busy} maxLength={254} aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? `${id}-email-error` : undefined} autoFocus={!isRegister} />
            {errors.email && <p id={`${id}-email-error`} className="text-xs text-destructive">{errors.email}</p>}
          </div>
          <div className="space-y-1.5">
            <label htmlFor={`${id}-password`} className="text-sm font-medium">Password</label>
            <Input id={`${id}-password`} name="password" type="password" value={values.password} onChange={(event) => updateField('password', event.target.value)} autoComplete={isRegister ? 'new-password' : 'current-password'} disabled={busy} aria-invalid={Boolean(errors.password)} aria-describedby={errors.password ? `${id}-password-error` : isRegister ? `${id}-password-help` : undefined} />
            {errors.password ? <p id={`${id}-password-error`} className="text-xs text-destructive">{errors.password}</p> : isRegister && <p id={`${id}-password-help`} className="text-xs text-muted-foreground">Use at least 12 characters, up to 72 UTF-8 bytes.</p>}
          </div>
          {error && <p role="alert" className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={busy} className="mt-2 w-full">
            {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : null}
            {busy ? 'Connecting…' : isRegister ? 'Create account' : 'Sign in'}
            {!busy && <ArrowRight className="size-4" aria-hidden="true" />}
          </Button>
        </form>
        <p className="text-center text-xs leading-relaxed text-muted-foreground">Your workspace data is only available to your account.</p>
      </DialogContent>
    </Dialog>
  );
}
