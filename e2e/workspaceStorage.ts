function workspaceStorageState(origin: string, layout: "full" | "focused") {
  return {
    cookies: [],
    origins: [
      {
        origin,
        localStorage: [
          {
            name: "plaincad.workspace.v1",
            value: JSON.stringify({ version: 1, layout, pins: [] }),
          },
        ],
      },
    ],
  };
}

export function fullWorkspaceStorageState(origin: string) {
  return workspaceStorageState(origin, "full");
}

export function focusedWorkspaceStorageState(origin: string) {
  return workspaceStorageState(origin, "focused");
}
