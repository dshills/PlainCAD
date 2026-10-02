import { importProjectText } from "./projectCodec";
import { PROJECT_IMPORT_LIMITS } from "./importSafety";
self.onmessage = async (event: MessageEvent<File>) => {
  try {
    if (event.data.size > PROJECT_IMPORT_LIMITS.maxBytes)
      throw new Error("Project file is too large.");
    self.postMessage({ progress: "Reading and validating project…" });
    self.postMessage({ result: importProjectText(await event.data.text()) });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
