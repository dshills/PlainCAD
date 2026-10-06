import { useEffect, useState, type ReactNode } from "react";

// Defer subscriptions and derived calculations until a panel is requested. Once
// visited, keep its local form drafts intact through hiding and layout switches.
export function RetainedPanel({
  visible,
  children,
}: {
  visible: boolean;
  children: ReactNode;
}) {
  const [visited, setVisited] = useState(visible);
  useEffect(() => {
    if (visible) setVisited(true);
  }, [visible]);
  return visible || visited ? children : null;
}
