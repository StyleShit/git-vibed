import type { ReactElement } from "react";
import { useEffect } from "react";
import { render, type RenderResult } from "@testing-library/react";
import { Toast } from "@base-ui-components/react/toast";
import { Tooltip } from "@base-ui-components/react/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useRepo, type TabData } from "../stores/repo";
import { toastManager } from "../stores/ui";
import { ConfirmProvider } from "../components/ui/Confirm";

function emptyTab(path: string): TabData {
  return {
    path,
    status: null,
    branches: [],
    commits: [],
    commitsExhausted: false,
    loadingMoreCommits: false,
    remotes: [],
    prs: [],
    stashes: [],
    tags: [],
    worktrees: [],
    undo: { canUndo: false, canRedo: false },
    ghAvailable: false,
    behindRemote: 0,
    loading: false,
    backgroundFetching: false,
  };
}

// Mirrors the listener wired in App.tsx so smoke tests can fire a
// REPO_CHANGED event and see the store refresh.
function RepoEventBridge() {
  useEffect(() => {
    const s = useRepo.getState();
    const off = window.gitApi.onRepoChanged((e) => {
      const target = e.repoPath;
      if (e.type === "index" || e.type === "worktree") {
        void s.refreshStatus(target);
        void s.refreshStashes(target);
      }
      if (e.type === "head") {
        void s.refreshStatus(target);
        void s.refreshBranches(target);
        void s.refreshLog({ all: true }, target);
      }
      if (e.type === "refs") {
        void s.refreshBranches(target);
        void s.refreshLog({ all: true }, target);
      }
    });
    return () => {
      off();
    };
  }, []);
  return null;
}

interface SeedOptions {
  initialTab?: Partial<TabData> & { path: string };
  queryClient?: QueryClient;
}

// Each test gets a fresh QueryClient with retry off so errors surface
// synchronously; tests that need to seed cache state can pass in their
// own client and call queryClient.setQueryData before render.
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false },
      mutations: { retry: false },
    },
  });
}

// Seed the repo store with a single active tab and render `ui` inside a
// wrapper that also registers the REPO_CHANGED bridge.
export function renderWithRepo(
  ui: ReactElement,
  { initialTab, queryClient = createTestQueryClient() }: SeedOptions = {},
): RenderResult & { queryClient: QueryClient } {
  if (initialTab) {
    useRepo.setState({
      tabs: [{ ...emptyTab(initialTab.path), ...initialTab }],
      activeIdx: 0,
    });
  }
  const result = render(
    <QueryClientProvider client={queryClient}>
      <Toast.Provider toastManager={toastManager}>
        <Tooltip.Provider>
          <ConfirmProvider>
            <RepoEventBridge />
            {ui}
          </ConfirmProvider>
        </Tooltip.Provider>
      </Toast.Provider>
    </QueryClientProvider>,
  );
  return Object.assign(result, { queryClient });
}
