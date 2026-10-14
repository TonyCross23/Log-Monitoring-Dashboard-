import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Activity, ArrowDownToLine, ArrowRight, ArrowUpRight, BookOpen, Check, ChevronDown,
  ChevronRight, CircleAlert, Clock3, Code2, Copy, FolderKanban, Gauge, LayoutDashboard,
  ListFilter, LogOut, Menu, Plus, Radio, RefreshCw, Search, Settings2, ShieldCheck,
  Terminal, TriangleAlert, X, Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useProjects, useLogs, useSessionCacheCleanup } from '@/features/data/use-dashboard';
import { useAuthStore } from '@/stores/auth-store';
import { useUIStore } from '@/stores/ui-store';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { LogEntry, LogLevel, Project } from '@/lib/models';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { ActivityChart } from '@/components/dashboard/activity-chart';
import { LevelBadge, LogTable, RecentLogsHeader } from '@/components/dashboard/log-table';
import { MonitoringPage } from '@/features/monitoring/monitoring-page';

type View = 'overview' | 'logs' | 'projects' | 'monitoring' | 'settings';
const AuthDialog = lazy(() => import('@/features/auth/auth-dialog').then((module) => ({ default: module.AuthDialog })));
const CreateProjectDialog = lazy(() => import('@/features/projects/create-project-dialog').then((module) => ({ default: module.CreateProjectDialog })));
const LogDetail = lazy(() => import('@/features/logs/log-detail').then((module) => ({ default: module.LogDetail })));
const navigation: { id: View; label: string; icon: LucideIcon }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'logs', label: 'Log explorer', icon: Terminal },
  { id: 'projects', label: 'Projects', icon: FolderKanban },
  { id: 'monitoring', label: 'API monitors', icon: Activity },
  { id: 'settings', label: 'Preferences', icon: Settings2 },
];
const duration = { '1h': 3_600_000, '24h': 86_400_000, '7d': 604_800_000 };
const levelColors: Record<LogLevel, string> = { INFO: '#16a47d', ERROR: '#ed6669', WARN: '#e9af53', DEBUG: '#8b91ab', TRACE: '#b4b8c6', FATAL: '#b73c52' };

function Logo() {
  return <div className="brand"><div className="brand-mark" aria-hidden="true"><span /><span /><span /></div><span>logline<span className="brand-dot">.</span></span></div>;
}

function Sidebar({ onConnect, onCreate, onGuide, onLogout }: { onConnect: () => void; onCreate: () => void; onGuide: () => void; onLogout: () => void }) {
  const { view, setView, setSidebarOpen, selectedProjectId, setProject } = useUIStore();
  const { mode, user } = useAuthStore();
  const projects = useProjects();
  const navigate = (next: View) => { setView(next); setSidebarOpen(false); };
  const initials = (user?.name ?? 'Workspace').split(' ').slice(0, 2).map((part) => part[0]).join('');
  return <aside className="sidebar-content">
    <div className="sidebar-brand"><Logo /><span className="sidebar-version">v1.0</span></div>
    <button className="workspace-picker" onClick={mode === 'demo' || !user ? onConnect : () => navigate('settings')}><span className="workspace-symbol">{mode === 'demo' ? 'A' : initials[0]}</span><span><strong>{mode === 'demo' ? 'Acme workspace' : `${user?.name.split(' ')[0] ?? 'Your'}'s workspace`}</strong><small>{mode === 'demo' ? 'Demo environment' : 'Connected workspace'}</small></span><ChevronDown size={15} /></button>
    <div className="nav-section-label">WORKSPACE</div>
    <nav aria-label="Main navigation" className="sidebar-nav">{navigation.map((item) => <button key={item.id} onClick={() => navigate(item.id)} className={cn('nav-item', view === item.id && 'nav-item-active')} aria-current={view === item.id ? 'page' : undefined}><item.icon size={18} strokeWidth={1.7} /><span>{item.label}</span>{item.id === 'projects' && <small>{projects.data?.length ?? 0}</small>}{view === item.id && <span className="nav-active-dot" />}</button>)}</nav>
    <div className="nav-section-label projects-label">YOUR PROJECTS <button aria-label="Create a project" onClick={onCreate}><Plus size={14} /></button></div>
    <div className="sidebar-projects">{projects.data?.slice(0, 5).map((project, index) => <button key={project.id} className={cn('sidebar-project', selectedProjectId === project.id && 'sidebar-project-selected')} onClick={() => { setProject(project.id); navigate('logs'); }}><span className={cn('project-dot', `project-dot-${index % 3}`)} /><span>{project.name}</span><ChevronRight size={13} /></button>)}{projects.isSuccess && !projects.data.length && <button className="sidebar-project" onClick={onCreate}><Plus size={15} /><span>Your first project</span></button>}</div>
    <div className="sidebar-bottom"><div className="getting-started"><div className="guide-icon"><Zap size={17} /></div><h3>A little clarity goes a long way.</h3><p>Send your first log and see what your app is telling you.</p><button onClick={onGuide}>Get started <ArrowUpRight size={14} /></button></div>
      <button className="sidebar-help" onClick={onGuide}><BookOpen size={17} /><span>Integration guide</span><ArrowUpRight size={14} /></button>
      <div className="sidebar-profile"><span className="avatar">{initials}</span><span><strong>{user?.name ?? 'Your workspace'}</strong><small>{mode === 'demo' ? 'Exploring the demo' : user?.email}</small></span><button aria-label={mode === 'demo' || !user ? 'Connect your account' : 'Sign out'} onClick={mode === 'demo' || !user ? onConnect : onLogout}>{mode === 'demo' || !user ? <ArrowRight size={17} /> : <LogOut size={17} />}</button></div>
    </div>
  </aside>;
}

function StatCard({ title, value, note, icon: Icon, color, series }: { title: string; value: string; note: string; icon: LucideIcon; color: string; series: number[] }) {
  const max = Math.max(1, ...series);
  const points = series.map((item, index) => `${(index / Math.max(1, series.length - 1)) * 82},${26 - (item / max) * 21}`).join(' ');
  return <article className="stat-card"><div className="stat-title"><span>{title}</span><span className="stat-icon" style={{ color, backgroundColor: `${color}10` }}><Icon size={17} /></span></div><div className="stat-value-row"><strong>{value}</strong><svg width="84" height="30" viewBox="0 0 84 30" aria-hidden="true"><polyline points={points} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" /></svg></div><p><span style={{ color }} className="stat-note-dot" />{note}</p></article>;
}

function ErrorPanel({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div role="alert" className="error-panel"><CircleAlert size={20} /><div><strong>We couldn't load this view.</strong><p>{message}</p></div><Button size="sm" variant="outline" onClick={onRetry}>Try again</Button></div>;
}

function exportLogs(logs: LogEntry[], projectName: string) {
  const escape = (value: string) => `"${(/^[=+\-@\t\r]/.test(value) ? `'${value}` : value).replaceAll('"', '""')}"`;
  const csv = ['Timestamp,Level,Message,Stack trace', ...logs.map((log) => [log.createdAt, log.level, log.message, log.stackTrace ?? ''].map(escape).join(','))].join('\r\n');
  const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8;' }));
  const anchor = document.createElement('a'); anchor.href = url;
  anchor.download = `logline-${projectName.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-logs.csv`;
  anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast.success(`Exported ${logs.length} loaded logs`);
}

export function App() {
  useSessionCacheCleanup();
  const state = useUIStore();
  const { mode, user, enterDemo, sessionGeneration } = useAuthStore();
  const queryClient = useQueryClient();
  const [authOpen, setAuthOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [selectedLog, setSelectedLog] = useState<LogEntry | null>(null);
  const [anchor, setAnchor] = useState(Date.now());
  const searchRef = useRef<HTMLInputElement>(null);
  const projectsQuery = useProjects();
  const projects = projectsQuery.data ?? [];
  const project = projects.find((item) => item.id === state.selectedProjectId);
  const search = useDebouncedValue(state.search);
  const filters = useMemo(() => ({ search: search || undefined, level: state.level, from: new Date(anchor - duration[state.range]).toISOString(), to: state.live ? undefined : new Date(anchor).toISOString(), limit: 100 }), [search, state.level, anchor, state.range, state.live]);
  const logsQuery = useLogs(project?.id ?? null, filters, state.live);
  const logs = logsQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const errors = logs.filter((log) => ['ERROR', 'FATAL'].includes(log.level));
  const warnings = logs.filter((log) => log.level === 'WARN');
  const errorRate = logs.length ? ((errors.length / logs.length) * 100).toFixed(1) : '0.0';
  const selectedNav = navigation.find((item) => item.id === state.view);
  const counts = (level?: LogLevel) => Array.from({ length: 12 }, (_, index) => logs.slice(index * Math.ceil(logs.length / 12), (index + 1) * Math.ceil(logs.length / 12)).filter((log) => !level || log.level === level).length);
  const distribution = (['INFO', 'WARN', 'ERROR', 'DEBUG', 'TRACE', 'FATAL'] as const).map((level) => ({ level, count: logs.filter((log) => log.level === level).length })).filter((item) => item.count > 0);

  useEffect(() => {
    if (projectsQuery.isSuccess && !projectsQuery.data.some((item) => item.id === state.selectedProjectId)) state.setProject(projectsQuery.data[0]?.id ?? '');
  }, [projectsQuery.data, projectsQuery.isSuccess, state.selectedProjectId, state.setProject]);
  useEffect(() => { setAnchor(Date.now()); }, [state.range, state.selectedProjectId, state.live]);
  useEffect(() => {
    if (!state.live) return;
    const interval = setInterval(() => setAnchor(Date.now()), 60_000);
    return () => clearInterval(interval);
  }, [state.live]);
  useEffect(() => { if (mode === 'live' && !user && !signingOut) setAuthOpen(true); }, [mode, user, signingOut]);
  useEffect(() => { setSelectedLog(null); setCreateOpen(false); }, [sessionGeneration]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') { event.preventDefault(); state.setView('logs'); searchRef.current?.focus(); }
    };
    window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler);
  }, [state.setView]);
  const refresh = () => { setAnchor(Date.now()); void projectsQuery.refetch(); };
  const logout = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try { await api.logout(); toast.success('Signed out of your workspace'); }
    catch { toast.error('Local session cleared. Server logout could not be confirmed.'); }
    finally { enterDemo(); queryClient.clear(); state.setSearch(''); state.setLevel('ALL'); state.setView('overview'); setSigningOut(false); }
  };
  const createProject = () => { setCreateOpen(true); state.setSidebarOpen(false); };
  const sidebarProps = { onConnect: () => setAuthOpen(true), onCreate: createProject, onGuide: () => setGuideOpen(true), onLogout: () => { void logout(); } };

  const projectSelect = <Select value={project?.id ?? ''} onValueChange={state.setProject}><SelectTrigger className="project-select" aria-label="Select project"><FolderKanban size={15} /><SelectValue placeholder={projectsQuery.isLoading ? 'Loading projects…' : 'Select a project'} /></SelectTrigger><SelectContent>{projects.map((item) => <SelectItem value={item.id} key={item.id}>{item.name}</SelectItem>)}</SelectContent></Select>;
  const rangeSelect = <Select value={state.range} onValueChange={(value) => { if (value === '1h' || value === '24h' || value === '7d') state.setRange(value); }}><SelectTrigger className="range-select" aria-label="Time range"><Clock3 size={14} /><SelectValue /></SelectTrigger><SelectContent><SelectItem value="1h">Last hour</SelectItem><SelectItem value="24h">Last 24 hours</SelectItem><SelectItem value="7d">Last 7 days</SelectItem></SelectContent></Select>;

  return <div className="app-shell">
    <a href="#main-content" className="skip-link">Skip to content</a>
    <div className="desktop-sidebar"><Sidebar {...sidebarProps} /></div>
    <Sheet open={state.sidebarOpen} onOpenChange={state.setSidebarOpen}><SheetContent side="left" className="mobile-sidebar"><SheetTitle className="sr-only">Workspace navigation</SheetTitle><SheetDescription className="sr-only">Navigate your workspace and projects.</SheetDescription><Sidebar {...sidebarProps} /></SheetContent></Sheet>
    <div className="workspace-main">
      <header className="topbar"><div className="breadcrumb"><button className="mobile-menu" aria-label="Open navigation" onClick={() => state.setSidebarOpen(true)}><Menu size={21} /></button><span className="breadcrumb-home"><FolderKanban size={16} /> Workspace</span><ChevronRight size={13} /><strong>{selectedNav?.label}</strong></div>
        <div className="global-search"><Search size={15} /><input ref={searchRef} value={state.search} onChange={(event) => { state.setSearch(event.target.value); state.setView('logs'); }} placeholder="Search log messages…" aria-label="Search log messages" maxLength={200} /><kbd>⌘ K</kbd></div>
        <div className="topbar-actions"><span className={cn('environment-pill', mode === 'demo' && 'demo-pill')}><i />{mode === 'demo' ? 'Demo workspace' : user ? 'Connected' : 'Signed out'}</span><button className="topbar-avatar" onClick={mode === 'demo' || !user ? () => setAuthOpen(true) : () => state.setView('settings')} aria-label={mode === 'demo' || !user ? 'Connect your workspace' : 'View preferences'}>{(user?.name ?? 'MC').split(' ').slice(0, 2).map((part) => part[0]).join('')}</button></div>
      </header>
      <main id="main-content" className="main-content">
        <div className="page-heading"><div><div className="eyebrow"><span /> YOUR OBSERVABILITY WORKSPACE</div><h1>{state.view === 'overview' ? 'A clearer view of your applications.' : state.view === 'logs' ? 'Every event. A little more context.' : state.view === 'projects' ? 'One workspace. All your projects.' : state.view === 'monitoring' ? 'A pulse on your API.' : 'Make yourself at home.'}</h1><p>{state.view === 'overview' ? 'Less noise, more signal. Here’s what’s happening in your selected project.' : state.view === 'logs' ? 'Find the story behind your logs, one event at a time.' : state.view === 'projects' ? 'Connect your services and keep their logs together.' : state.view === 'monitoring' ? 'Follow CEIR endpoint availability and response times.' : 'Fine-tune how you explore your applications.'}</p></div>{state.view !== 'monitoring' && <Button onClick={createProject} className="new-project-button"><Plus size={16} /> New project</Button>}</div>

        {mode === 'demo' && <div className="demo-notice"><span className="demo-notice-icon"><Zap size={14} /></span><p>You’re exploring a sample workspace. <span>Ready to see your own logs?</span></p><button onClick={() => setAuthOpen(true)}>Connect your workspace <ArrowRight size={14} /></button></div>}
        {projectsQuery.isError && <ErrorPanel message={projectsQuery.error.message} onRetry={refresh} />}
        {(state.view === 'overview' || state.view === 'logs') && <>
          <div className="view-toolbar"><div className="view-toolbar-left">{projectSelect}<span className="toolbar-divider" /><span className="project-scope"><span className="green-dot" />{project ? 'Project selected' : 'No project yet'}</span></div><div className="view-toolbar-right">{rangeSelect}<button className="refresh-button" aria-label="Refresh logs" onClick={refresh} disabled={logsQuery.isFetching}><RefreshCw size={16} className={cn(logsQuery.isFetching && 'animate-spin')} /></button></div></div>
          {logsQuery.isError && <ErrorPanel message={logsQuery.error.message} onRetry={refresh} />}
          {!project && projectsQuery.isSuccess && <div className="panel welcome-panel"><div className="empty-icon"><Terminal size={27} /></div><h2>Your first signal starts here.</h2><p>Create a project, copy its API key, and send your first log.</p><Button onClick={createProject}><Plus size={16} /> Create your first project</Button></div>}
        </>}

        {state.view === 'overview' && project && <>
          <section className="stats-grid" aria-label="Loaded log statistics">
            <StatCard title="Logs in this view" value={logs.length.toLocaleString()} note="From the loaded result pages" icon={Terminal} color="#16a47d" series={counts()} />
            <StatCard title="Errors" value={errors.length.toLocaleString()} note={`${errorRate}% of loaded events`} icon={CircleAlert} color="#e46b6d" series={counts('ERROR')} />
            <StatCard title="Warnings" value={warnings.length.toLocaleString()} note="Worth a closer look" icon={TriangleAlert} color="#d7a347" series={counts('WARN')} />
            <StatCard title="Your projects" value={projects.length.toLocaleString()} note="Connected in this workspace" icon={FolderKanban} color="#7b84b3" series={projects.map(() => 1)} />
          </section>
          <section className="insights-grid"><article className="panel activity-panel"><div className="panel-header"><div><h2>Log activity</h2><p>Volume of the logs loaded in this view</p></div><div className="chart-legend"><span><i /> Logs</span><span className="chart-range-label">{state.range === '1h' ? '60 minutes' : state.range === '24h' ? '24 hours' : '7 days'}</span></div></div><ActivityChart logs={logs} from={anchor - duration[state.range]} to={Date.now()} /><div className="chart-footer"><span><Activity size={13} /> Every event tells a story.</span><span>{logs.length} loaded events</span></div></article>
            <article className="panel distribution-panel"><div className="panel-header"><div><h2>Log distribution</h2><p>A breakdown by severity</p></div><ListFilter size={17} /></div><div className="distribution-total"><strong>{logs.length.toLocaleString()}</strong><span>events in this view</span></div><div className="distribution-bar" aria-hidden="true">{distribution.map((item) => <span key={item.level} style={{ width: `${(item.count / Math.max(1, logs.length)) * 100}%`, backgroundColor: levelColors[item.level] }} />)}</div><div className="distribution-list">{distribution.length ? distribution.map((item) => <button key={item.level} onClick={() => { state.setLevel(item.level); state.setView('logs'); }}><span><i style={{ background: levelColors[item.level] }} />{item.level[0]}{item.level.slice(1).toLowerCase()}</span><strong>{item.count}<small>{Math.round((item.count / logs.length) * 100)}%</small><ChevronRight size={12} /></strong></button>) : <p>No events to summarize yet.</p>}</div></article>
          </section>
          <section className="panel recent-panel"><RecentLogsHeader count={Math.min(8, logs.length)} onViewAll={() => state.setView('logs')} /><LogTable logs={logs.slice(0, 8)} onSelect={setSelectedLog} compact loading={logsQuery.isLoading} /><div className="table-footer"><span><span className="green-dot" /> {state.live ? 'Refreshing every 5 seconds' : 'Refresh paused'}</span><button onClick={() => state.setLive(!state.live)}>{state.live ? 'Pause refresh' : 'Resume refresh'}</button></div></section>
          <div className="overview-bottom"><span><ShieldCheck size={14} /> Your logs, your workspace.</span><button onClick={() => setGuideOpen(true)}>Need a hand getting connected? <ArrowUpRight size={14} /></button></div>
        </>}

        {state.view === 'logs' && project && <section className="panel explorer-panel"><div className="explorer-top"><div className="panel-heading"><Terminal size={17} /><h2>Log explorer</h2><span className="count-badge">{logs.length}</span></div><div className="explorer-actions"><button className={cn('live-control', state.live && 'live-control-on')} onClick={() => state.setLive(!state.live)} aria-pressed={state.live}><Radio size={14} />{state.live ? 'Live refresh' : 'Paused'}</button><Button variant="outline" size="sm" disabled={!logs.length} onClick={() => exportLogs(logs, project.name)}><ArrowDownToLine size={14} /> Export</Button></div></div>
          <div className="filter-bar"><div className="severity-tabs" aria-label="Filter logs by severity">{(['ALL', 'ERROR', 'WARN', 'INFO', 'DEBUG', 'TRACE', 'FATAL'] as const).map((level) => <button className={cn(state.level === level && 'severity-tab-active')} key={level} aria-pressed={state.level === level} onClick={() => state.setLevel(level)}>{level === 'ALL' ? 'All levels' : level[0] + level.slice(1).toLowerCase()}{level === 'ERROR' && errors.length > 0 && <span>{errors.length}</span>}</button>)}</div><div className="filter-search"><Search size={15} /><input value={state.search} onChange={(event) => state.setSearch(event.target.value)} placeholder="Search messages…" aria-label="Filter log messages" maxLength={200} />{state.search && <button aria-label="Clear search" onClick={() => state.setSearch('')}><X size={13} /></button>}</div></div>
          <LogTable logs={logs} onSelect={setSelectedLog} loading={logsQuery.isLoading} /><div className="table-footer explorer-footer"><span>{logs.length} loaded logs{state.level !== 'ALL' ? ` · ${state.level.toLowerCase()} level` : ''}</span>{logsQuery.hasNextPage ? <Button variant="outline" size="sm" disabled={logsQuery.isFetching} onClick={() => { void logsQuery.fetchNextPage(); }}>{logsQuery.isFetchingNextPage ? <RefreshCw className="animate-spin" size={14} /> : <ChevronDown size={14} />}Load more logs</Button> : <span>You're all caught up <Check size={13} /></span>}</div>
        </section>}

        {state.view === 'projects' && <section className="projects-grid">{projects.map((item, index) => <ProjectCard key={item.id} project={item} index={index} onOpen={() => { state.setProject(item.id); state.setSearch(''); state.setLevel('ALL'); state.setView('logs'); }} />)}<button className="new-project-card" onClick={createProject}><span><Plus size={24} /></span><strong>A new project, a new perspective.</strong><p>Connect another service to your workspace.</p><small>Create project <ArrowRight size={14} /></small></button></section>}

        {state.view === 'monitoring' && <MonitoringPage onConnect={() => setAuthOpen(true)} />}

        {state.view === 'settings' && <div className="settings-grid"><section className="panel settings-panel"><div className="settings-heading"><Settings2 size={20} /><div><h2>Workspace preferences</h2><p>Small adjustments for a better view.</p></div></div><div className="setting-row"><div><strong>Live refresh</strong><p>Fetch new logs every 5 seconds while this tab is visible.</p></div><button role="switch" aria-checked={state.live} aria-label="Enable live refresh" onClick={() => state.setLive(!state.live)} className={cn('toggle-switch', state.live && 'toggle-switch-on')}><span /></button></div><div className="setting-row"><div><strong>Default time window</strong><p>The time range used in your log views.</p></div>{rangeSelect}</div><div className="setting-row"><div><strong>Display time zone</strong><p>Log timestamps follow your browser's local time.</p></div><span className="setting-value">{Intl.DateTimeFormat().resolvedOptions().timeZone}</span></div></section>
          <section className="panel settings-panel"><div className="settings-heading"><ShieldCheck size={20} /><div><h2>Workspace connection</h2><p>{mode === 'demo' ? 'Sample data. No credentials required.' : user ? 'Connected to your backend API.' : 'Sign in to reconnect to the API.'}</p></div></div><div className="connection-details"><span className="connection-status"><i />{mode === 'demo' ? 'Demo mode' : user ? 'API mode' : 'Signed out'}</span><p>{mode === 'demo' || !user ? 'Sign in to see your own projects and logs.' : `Signed in as ${user?.email}. Access tokens are kept in memory; refresh sessions use secure server cookies.`}</p><code>{import.meta.env.VITE_API_URL || window.location.origin}</code></div><div className="settings-actions">{mode === 'demo' || !user ? <Button onClick={() => setAuthOpen(true)}>Connect your workspace <ArrowRight size={15} /></Button> : <Button variant="outline" onClick={() => { void logout(); }}><LogOut size={15} /> Sign out</Button>}<Button variant="ghost" onClick={() => setGuideOpen(true)}>Integration guide <ArrowUpRight size={15} /></Button></div></section></div>}
        <footer className="workspace-footer"><span>Built for the details that matter.</span><span>logline <span>·</span> {mode === 'demo' ? 'Sample data' : 'Your workspace'}</span></footer>
      </main>
    </div>
    <Suspense fallback={<span className="sr-only" role="status">Opening dialog…</span>}>
      {authOpen && <AuthDialog open={authOpen} onOpenChange={setAuthOpen} />}
      {createOpen && <CreateProjectDialog open={createOpen} onOpenChange={setCreateOpen} />}
      {selectedLog && <LogDetail log={selectedLog} onClose={() => setSelectedLog(null)} />}
    </Suspense>
    <Dialog open={guideOpen} onOpenChange={setGuideOpen}><DialogContent className="guide-dialog"><DialogHeader><DialogTitle>From your application to a clearer picture.</DialogTitle><DialogDescription>Three small steps to start collecting your logs.</DialogDescription></DialogHeader><div className="guide-steps">{[{ icon: FolderKanban, title: 'Create a project', text: 'Give your service a name. Each project gets its own API key.' }, { icon: ShieldCheck, title: 'Keep your key safe', text: 'Copy it when the project is created. Use it only in trusted server applications.' }, { icon: Code2, title: 'Send your first event', text: 'Post JSON to the log endpoint with your API key in the X-API-Key header.' }].map((step, index) => <div className="guide-step" key={step.title}><span>{index + 1}</span><div><h3><step.icon size={15} />{step.title}</h3><p>{step.text}</p></div></div>)}</div><pre className="integration-code">{`POST /api/v1/logs\nX-API-Key: <your-project-api-key>\nContent-Type: application/json\n\n{\n  "level": "INFO",\n  "message": "Your first signal is here.",\n  "metadata": { "service": "my-api" }\n}`}</pre><div className="guide-actions"><Button onClick={() => { setGuideOpen(false); createProject(); }}><Plus size={15} /> Create a project</Button><Button variant="outline" onClick={async () => { try { await navigator.clipboard.writeText(`${import.meta.env.VITE_API_URL || window.location.origin}/api/v1/logs`); toast.success('Ingestion endpoint copied'); } catch { toast.error('Could not access your clipboard'); } }}><Copy size={15} />Copy endpoint</Button></div></DialogContent></Dialog>
  </div>;
}

function ProjectCard({ project, index, onOpen }: { project: Project; index: number; onOpen: () => void }) {
  return <article className="panel project-card"><div className="project-card-top"><span className={cn('project-card-icon', `project-card-icon-${index % 3}`)}>{index % 3 === 0 ? <Terminal size={22} /> : index % 3 === 1 ? <LayoutDashboard size={22} /> : <Gauge size={22} />}</span><span className="project-ready"><span className="green-dot" /> Ready for logs</span></div><h2>{project.name}</h2><p>Created {new Date(project.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}</p><div className="project-key"><span>API key prefix</span><code>{project.apiKeyPrefix}••••••</code><ShieldCheck size={14} /></div><div className="project-card-footer"><span>Project ID <code>{project.id.slice(0, 8)}</code></span><Button variant="ghost" size="sm" onClick={onOpen}>Explore logs <ArrowUpRight size={15} /></Button></div></article>;
}
