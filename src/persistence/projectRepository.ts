import { CadDocument } from "../cad/document/schema";
import { projectFilename, PROJECT_FILE_MIME_TYPE, serializeProject } from "./exportProject";
import { importProjectText } from "./importProject";

export interface SavedProject {
  filename: string;
  mimeType: string;
  text: string;
  bytes: ArrayBuffer;
}

export function saveProject(document: CadDocument): SavedProject {
  const text = serializeProject(document);
  return {
    filename: projectFilename(document),
    mimeType: PROJECT_FILE_MIME_TYPE,
    text,
    bytes: new TextEncoder().encode(text).buffer,
  };
}

export function loadProject(text: string): CadDocument {
  return importProjectText(text);
}
