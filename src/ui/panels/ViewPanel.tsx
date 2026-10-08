import { lazy, Suspense } from "react";
import { LazyPanelBoundary } from "../design-system/LazyPanelBoundary";

const ViewPanelContent = lazy(() => import("./ViewPanelContent").then((module) => ({ default: module.ViewPanelContent })));

export function ViewPanel() {
  return <LazyPanelBoundary label="View controls"><Suspense fallback={<p className="muted" role="status">Loading view controls…</p>}><ViewPanelContent /></Suspense></LazyPanelBoundary>;
}
