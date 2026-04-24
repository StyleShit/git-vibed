import type { ReactElement } from "react";
import { render, type RenderResult } from "@testing-library/react";
import { Toast } from "@base-ui-components/react/toast";
import { Tooltip } from "@base-ui-components/react/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useRepo, type TabData } from "../stores/repo";
import { toastManager } from "../stores/ui";
import { ConfirmProvider } from "../components/ui/Confirm";
import { RepoEventBridge } from "../queries/RepoEventBridge";

function emptyTab(path: string): TabData {
  return {
    path,
    behindRemote: 0,
    backgroundFetching: false,
  };
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
      <RepoEventBridge />
      <Toast.Provider toastManager={toastManager}>
        <Tooltip.Provider>
          <ConfirmProvider>{ui}</ConfirmProvider>
        </Tooltip.Provider>
      </Toast.Provider>
    </QueryClientProvider>,
  );
  return Object.assign(result, { queryClient });
}
