import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app/App";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "./styles.css";
import "./ui/design-system/workbench.css";
import { applyTheme } from "./ui/themes/themes";
import { useThemeState } from "./state/useThemeState";

applyTheme(useThemeState.getState().theme);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
