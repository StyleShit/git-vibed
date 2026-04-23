import { QueryClient } from "@tanstack/react-query";

// IPC errors typically surface through toast() at the call site, and
// retrying a git command behind the user's back isn't useful — if it
// failed once it'll usually fail the same way. Turn retries off so
// errors bubble immediately.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnReconnect: false,
      // Individual hooks override this; default off so we don't churn
      // branches / log / stashes every time the window regains focus.
      refetchOnWindowFocus: false,
    },
  },
});
