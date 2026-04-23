import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Toast } from "@base-ui-components/react/toast";
import "./index.css";
import "./monaco-setup";
import { App } from "./App";
import { ConfirmProvider } from "./components/ui/Confirm";
import { toastManager } from "./stores/ui";

const root = createRoot(document.getElementById("root") as HTMLElement);
root.render(
  <StrictMode>
    <Toast.Provider toastManager={toastManager}>
      <ConfirmProvider>
        <App />
      </ConfirmProvider>
    </Toast.Provider>
  </StrictMode>,
);
