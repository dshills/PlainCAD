import ImportWorker from "./importWorker?worker";
import { backgroundJob } from "./backgroundJob";
import { importProjectText } from "./projectCodec";
import { PROJECT_IMPORT_LIMITS } from "./importSafety";
import type { CadDocument } from "../cad/document/schema";
export { importProjectText } from "./projectCodec";

export async function importProjectFile(
  file: File,
  signal?: AbortSignal,
  progress?: (message: string) => void,
): Promise<CadDocument> {
  if (signal?.aborted) throw new Error("Operation cancelled.");
  if (file.size > PROJECT_IMPORT_LIMITS.maxBytes)
    throw new Error("Project file is too large.");
  if (typeof Worker !== "undefined")
    return backgroundJob<File, CadDocument>(
      ImportWorker,
      file,
      signal,
      progress,
    );
  progress?.("Reading and validating project…");
  const text = await file.text();
  if (signal?.aborted) throw new Error("Operation cancelled.");
  return importProjectText(text);
}
