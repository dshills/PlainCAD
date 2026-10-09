import { lazy, Suspense } from "react";
import { LazyPanelBoundary } from "../design-system/LazyPanelBoundary";
const MacrosPanel = lazy(() => import("../panels/MacrosPanel").then(module => ({ default: module.MacrosPanel })));
const LiveSessionPanel = lazy(() => import("../panels/LiveSessionPanel").then(module => ({ default: module.LiveSessionPanel })));
/** Workflow tools stay inside the same resizable bottom dock as History and AI. */
export function AutomationDockContent() {
  return <LazyPanelBoundary label="Automation tools"><Suspense fallback={<p role="status">Loading automation tools…</p>}><MacrosPanel /><LiveSessionPanel /></Suspense></LazyPanelBoundary>;
}
