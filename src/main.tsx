import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "./monaco-setup";
import { App } from "./App";
import { ConfirmProvider } from "./components/ui/Confirm";

const root = createRoot(document.getElementById("root") as HTMLElement);
root.render(
  <StrictMode>
    <ConfirmProvider>
      <App />
    </ConfirmProvider>
  </StrictMode>,
);
