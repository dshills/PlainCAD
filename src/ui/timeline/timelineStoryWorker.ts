import { OpenCascadeKernel } from "../../cad/kernel/OpenCascadeKernel";
import { rebuildDocument } from "../../cad/features/rebuildGraph";
import { timelineStoryDocuments } from "../../cad/document/timelineStory";
import type { CadDocument } from "../../cad/document/schema";
import { storyThumbnails } from "./timelineStoryThumbnail";
import { changedStoryBodies, nativeStoryGeometry } from "./timelineStoryProof";

self.onmessage = async (event: MessageEvent<{ document: CadDocument; featureId: string }>) => {
  try {
    const snapshots = timelineStoryDocuments(event.data.document, event.data.featureId);
    await OpenCascadeKernel.initialize();
    const before = nativeStoryGeometry(rebuildDocument(snapshots.before), "Before");
    const after = nativeStoryGeometry(rebuildDocument(snapshots.after), "After");
    const changed = changedStoryBodies(before, after);
    const afterIds = new Set(after.meshes.map(mesh => mesh.bodyId));
    const removedBodies = before.meshes.filter(mesh => !afterIds.has(mesh.bodyId)).length;
    const images = await storyThumbnails(before.meshes, after.meshes, changed);
    self.postMessage({ result: { ...images, beforeVolume: before.volume, afterVolume: after.volume, beforeSolids: before.solids, afterSolids: after.solids, changedBodies: changed.size, removedBodies } });
  } catch (error) { self.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
};
