import { create } from 'zustand';
import type { LogLevel } from '@/lib/models';
import { DEMO_PROJECT_IDS } from '@/lib/demo-data';

export type DashboardView = 'overview' | 'logs' | 'projects' | 'monitoring' | 'settings';
export type TimeRange = '1h' | '24h' | '7d';
interface UIState {
  view: DashboardView;
  selectedProjectId: string;
  search: string;
  level: LogLevel | 'ALL';
  range: TimeRange;
  live: boolean;
  sidebarOpen: boolean;
  setView: (view: DashboardView) => void;
  setProject: (selectedProjectId: string) => void;
  setSearch: (search: string) => void;
  setLevel: (level: LogLevel | 'ALL') => void;
  setRange: (range: TimeRange) => void;
  setLive: (live: boolean) => void;
  setSidebarOpen: (sidebarOpen: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
  view: 'overview', selectedProjectId: DEMO_PROJECT_IDS.payments,
  search: '', level: 'ALL', range: '24h', live: true, sidebarOpen: false,
  setView: (view) => set({ view, sidebarOpen: false }),
  setProject: (selectedProjectId) => set({ selectedProjectId, search: '', level: 'ALL' }),
  setSearch: (search) => set({ search }), setLevel: (level) => set({ level }),
  setRange: (range) => set({ range }), setLive: (live) => set({ live }),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
}));
