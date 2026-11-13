import { useState } from "react";
import { isPngResolution, type PngResolution } from "../persistence/pngResolution";
import { runCommand } from "../ui/commands/commandRegistry";

export function StudioPng({ enabled }: { enabled: boolean }) {
  const [resolution, setResolution] = useState<PngResolution>("viewport");
  return <>
    <label>PNG size
      <select aria-label="Studio PNG size" value={resolution} disabled={!enabled} onChange={event => {
        const value = event.target.value;
        if (isPngResolution(value)) setResolution(value);
      }}>
        <option value="viewport">Viewport</option>
        <option value="hd">1920 × 1080</option>
        <option value="uhd">3840 × 2160</option>
      </select>
    </label>
    <button type="button" className="ds-primary" disabled={!enabled}
      onClick={() => void runCommand("file.exportProjectPng", { pngResolution: resolution })}>Download studio PNG</button>
  </>;
}
