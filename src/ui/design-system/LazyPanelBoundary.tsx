import { Component, type ReactNode } from "react";

/** A failed optional chunk must leave the local project and editor available. */
export class LazyPanelBoundary extends Component<{ label: string; className?: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) { console.error(`${this.props.label} panel failed`, error); }
  render() {
    if (this.state.failed) return <p className={this.props.className} role="alert">{this.props.label} could not open. Save your project, then reload to retry.</p>;
    return this.props.children;
  }
}
