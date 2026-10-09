import { Component, type ReactNode } from "react";
export class CommandAgentBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <p role="alert">The command agent could not load. Save your project and reload the application to retry.</p> : this.props.children;
  }
}
