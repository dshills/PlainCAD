import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app/App";
import "./styles.css";
import { applyTheme } from "./ui/themes/themes";
import { useThemeState } from "./state/useThemeState";

applyTheme(useThemeState.getState().theme);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
