import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import {
  CrashErrorBoundary,
  installGlobalFrontendCrashHandlers,
} from "./components/CrashErrorBoundary";
import "./styles.css";

installGlobalFrontendCrashHandlers();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <CrashErrorBoundary>
      <App />
    </CrashErrorBoundary>
  </React.StrictMode>
);
