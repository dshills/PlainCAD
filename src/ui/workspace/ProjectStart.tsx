import type { CommandContext } from "../commands/commandRegistry";
import { runCommand } from "../commands/commandRegistry";
import { useCommandEnablement } from "../commands/useCommandEnablement";

export function ProjectStart({ context }: { context: CommandContext }) {
  const enabled = useCommandEnablement();
  return (
    <section className="project-start" aria-label="Start a part">
      <h1>What would you like to make?</h1>
      <p>Draw a shape, describe a part, or start from an example.</p>
      <div className="project-start-actions">
        <button
          type="button"
          disabled={!enabled.createSketch}
          onClick={() => void runCommand("sketch.create", context)}
        >
          Draw a shape
        </button>
        <button
          type="button"
          onClick={() => void runCommand("ai.toggle", context)}
        >
          Describe a part with AI
        </button>
        <details>
          <summary>Start from example</summary>
          <button
            type="button"
            aria-label="Load mounting plate template"
            onClick={() =>
              void runCommand("template.createMountingPlate", context)
            }
          >
            Mounting plate
          </button>
          <button
            type="button"
            aria-label="Load parametric box template"
            onClick={() => void runCommand("template.createBox", context)}
          >
            Parametric box
          </button>
        </details>
        <button
          type="button"
          onClick={() => void runCommand("file.openProject", context)}
        >
          Open an existing project
        </button>
      </div>
      <p className="muted">
        AI is optional. Your editable project stays local.
      </p>
    </section>
  );
}
