export function fullWorkspaceStorageState(origin: string) {
  return {
    cookies: [],
    origins: [
      {
        origin,
        localStorage: [
          {
            name: "plaincad.workspace.v1",
            value: JSON.stringify({ version: 1, layout: "full", pins: [] }),
          },
        ],
      },
    ],
  };
}
