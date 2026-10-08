import { useEffect } from "react";
import { useThemeState } from "../../state/useThemeState";
import { applyTheme, isThemeId, themes } from "./themes";
import "./saturnCommand.css";

export function ThemeSelector() {
  const { theme, setTheme, persistenceError } = useThemeState();
  useEffect(() => applyTheme(theme), [theme]);
  return (
    <div className="theme-control">
      <label>
        <span>Theme</span>
        <select
          aria-label="UI theme"
          value={theme}
          onChange={(event) => {
            if (isThemeId(event.target.value)) setTheme(event.target.value);
          }}
        >
          {themes.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {persistenceError ? (
        <span className="theme-storage-error" role="status">
          {persistenceError}
        </span>
      ) : null}
    </div>
  );
}
