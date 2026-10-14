import { useEffect } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { createDemoProject, fetchDemoLogs, listDemoProjects } from '@/lib/demo-data';
import type { CreateProjectInput, LogFilters, Project } from '@/lib/models';
import { useAuthStore } from '@/stores/auth-store';

function useDataScope() {
  const mode = useAuthStore((state) => state.mode);
  const user = useAuthStore((state) => state.user);
  const generation = useAuthStore((state) => state.sessionGeneration);
  return { mode, user, scope: [mode, user?.id ?? 'anonymous', generation] as const };
}

const retry = (count: number, error: Error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2;

export function useProjects() {
  const { mode, user, scope } = useDataScope();
  return useQuery({
    queryKey: ['projects', ...scope],
    queryFn: ({ signal }) => mode === 'demo' ? Promise.resolve(listDemoProjects()) : api.listProjects(signal),
    enabled: mode === 'demo' || user !== null,
    staleTime: 30_000, retry,
  });
}

export function useLogs(projectId: string | null, filters: LogFilters, live: boolean) {
  const { mode, user, scope } = useDataScope();
  return useInfiniteQuery({
    queryKey: ['logs', ...scope, projectId, filters],
    queryFn: ({ pageParam, signal }) => {
      if (!projectId) throw new Error('Select a project to load logs.');
      return mode === 'demo'
        ? Promise.resolve(fetchDemoLogs(projectId, filters, pageParam))
        : api.fetchLogs(projectId, filters, pageParam, signal);
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.pagination.hasMore ? lastPage.pagination.nextCursor ?? undefined : undefined,
    enabled: !!projectId && (mode === 'demo' || user !== null),
    refetchInterval: live ? 5_000 : false,
    refetchIntervalInBackground: false,
    staleTime: 5_000, retry,
  });
}

export function useCreateProject() {
  const { mode, scope } = useDataScope();
  const client = useQueryClient();
  return useMutation({
    mutationKey: ['create-project', ...scope],
    mutationFn: (input: CreateProjectInput) => mode === 'demo' ? Promise.resolve(createDemoProject(input)) : api.createProject(input),
    onSuccess: (result) => {
      // Keep selection valid even if the following project-list refresh fails.
      client.setQueryData<Project[]>(['projects', ...scope], (previous) => [
        result.project, ...(previous ?? []).filter((project) => project.id !== result.project.id),
      ]);
      return client.invalidateQueries({ queryKey: ['projects', ...scope] });
    },
    // A one-time API key must not linger in inactive mutation cache entries.
    gcTime: 0, retry: false,
  });
}

/** Remove data belonging to a previous account, including demo data, on session changes. */
export function useSessionCacheCleanup() {
  const client = useQueryClient();
  useEffect(() => useAuthStore.subscribe((state, previous) => {
    if (state.sessionGeneration !== previous.sessionGeneration) {
      void client.cancelQueries();
      client.removeQueries();
      client.getMutationCache().clear();
    }
  }), [client]);
}
