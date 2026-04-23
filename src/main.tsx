import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Toast } from "@base-ui-components/react/toast";
import { Tooltip } from "@base-ui-components/react/tooltip";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import "./index.css";
import "./monaco-setup";
import { App } from "./App";
import { ConfirmProvider } from "./components/ui/Confirm";
import { toastManager } from "./stores/ui";
import { queryClient } from "./queries/client";
import { RepoEventBridge } from "./queries/RepoEventBridge";

const root = createRoot(document.getElementById("root") as HTMLElement);
root.render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RepoEventBridge />
      <Toast.Provider toastManager={toastManager}>
        <Tooltip.Provider delay={400}>
          <ConfirmProvider>
            <App />
          </ConfirmProvider>
        </Tooltip.Provider>
      </Toast.Provider>
      {import.meta.env.DEV && <ReactQueryDevtools buttonPosition="bottom-right" />}
    </QueryClientProvider>
  </StrictMode>,
);
