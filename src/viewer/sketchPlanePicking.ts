import * as THREE from "three";
import {
  faceChoiceAt,
  type SketchPlaneChoice,
} from "../cad/sketch/planePicking";
import { useCadStore } from "../state/useCadStore";
import {
  finishProjectWorkflow,
  useProjectWorkflow,
  workflowCurrent,
} from "../ui/commands/projectWorkflowCommand";
import {
  currentPlaneChoices,
  useSketchPlanePicker,
} from "../ui/commands/sketchPlanePicker";
function clear(group: THREE.Group) {
  group.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.geometry.dispose();
      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      materials.forEach((material) => material.dispose());
    }
  });
  group.clear();
}
const vector = (point: { x: number; y: number; z: number }) =>
  new THREE.Vector3(point.x, point.y, point.z);
export function installSketchPlanePicking(
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
  camera: THREE.Camera,
  models: THREE.Group,
  clipping: () => THREE.Plane | undefined,
) {
  const planes = new THREE.Group(),
    highlight = new THREE.Group();
  scene.add(planes, highlight);
  const raycaster = new THREE.Raycaster(),
    pointer = new THREE.Vector2();
  let choices: SketchPlaneChoice[] = [],
    previousDocument: unknown,
    previousRebuild: unknown,
    previousActive: unknown,
    pointerDown: { x: number; y: number } | undefined;
  const active = () => {
    const workflow = useProjectWorkflow.getState().active;
    return workflow?.kind === "sketch" && workflowCurrent(workflow)
      ? workflow
      : undefined;
  };
  const hovered = () => {
    clear(highlight);
    const choice = active() ? useSketchPlanePicker.getState().hover : undefined;
    for (const object of planes.children)
      if (
        object instanceof THREE.Mesh &&
        object.material instanceof THREE.MeshBasicMaterial
      )
        object.material.color.set(
          choice?.id === object.userData.choiceId
            ? "#ffcf55"
            : object.userData.baseColor,
        );
    if (!choice?.bodyId) return;
    const model = models.children.find(
      (object) =>
        object instanceof THREE.Mesh &&
        object.visible &&
        object.userData.bodyId === choice.bodyId,
    ) as THREE.Mesh | undefined;
    if (!model) return;
    const geometry = model.geometry,
      position = geometry.getAttribute("position"),
      indices = geometry.index,
      vertices: number[] = [];
    const normal = vector(choice.transform.normal),
      origin = vector(choice.transform.origin);
    const a = new THREE.Vector3(),
      b = new THREE.Vector3(),
      c = new THREE.Vector3(),
      faceNormal = new THREE.Vector3(),
      edge = new THREE.Vector3();
    const constant = origin.dot(normal);
    const count = indices?.count ?? position.count;
    model.updateWorldMatrix(true, false);
    for (let i = 0; i < count; i += 3) {
      a.fromBufferAttribute(
        position,
        indices ? indices.getX(i) : i,
      ).applyMatrix4(model.matrixWorld);
      b.fromBufferAttribute(
        position,
        indices ? indices.getX(i + 1) : i + 1,
      ).applyMatrix4(model.matrixWorld);
      c.fromBufferAttribute(
        position,
        indices ? indices.getX(i + 2) : i + 2,
      ).applyMatrix4(model.matrixWorld);
      faceNormal.copy(b).sub(a).cross(edge.copy(c).sub(a)).normalize();
      if (
        faceNormal.dot(normal) < 1 - 1e-5 ||
        [a, b, c].some((point) => Math.abs(point.dot(normal) - constant) > 1e-5)
      )
        continue;
      vertices.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    }
    if (!vertices.length) return;
    const overlay = new THREE.BufferGeometry();
    overlay.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(vertices, 3),
    );
    highlight.add(
      new THREE.Mesh(
        overlay,
        new THREE.MeshBasicMaterial({
          color: "#ffcf55",
          transparent: true,
          opacity: 0.65,
          side: THREE.DoubleSide,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
        }),
      ),
    );
  };
  const refresh = () => {
    const state = useCadStore.getState(),
      workflow = active();
    if (
      previousDocument === state.history.present &&
      previousRebuild === state.rebuild &&
      previousActive === workflow
    )
      return;
    previousDocument = state.history.present;
    previousRebuild = state.rebuild;
    previousActive = workflow;
    clear(planes);
    clear(highlight);
    choices = workflow ? currentPlaneChoices(state) : [];
    if (!workflow) return;
    let span = 80;
    for (const mesh of state.rebuild.result?.meshes ?? [])
      span = Math.max(
        span,
        ...mesh.bounds.max.map(
          (value, index) => Math.abs(value - mesh.bounds.min[index]) * 1.5,
        ),
      );
    span = Math.min(span, 100000);
    for (const choice of choices.filter((item) => !item.bodyId)) {
      const transform = choice.transform,
        color =
          choice.id === "XY"
            ? "#3e9ac8"
            : choice.id === "XZ"
              ? "#63b66d"
              : "#da7865";
      const object = new THREE.Mesh(
        new THREE.PlaneGeometry(span, span),
        new THREE.MeshBasicMaterial({
          color,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.25,
          depthWrite: false,
        }),
      );
      const basis = new THREE.Matrix4().makeBasis(
        vector(transform.u),
        vector(transform.v),
        vector(transform.normal),
      );
      object.setRotationFromMatrix(basis);
      object.position.copy(vector(transform.origin));
      object.userData.choiceId = choice.id;
      object.userData.baseColor = color;
      planes.add(object);
    }
    planes.updateMatrixWorld(true);
    hovered();
  };
  const hit = (event: Pick<MouseEvent, "clientX" | "clientY">) => {
    const rect = renderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return { body: false };
    pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
    const body = raycaster
      .intersectObjects(
        models.children.filter((object) => object.visible),
        true,
      )
      .find(
        (item) =>
          item.object instanceof THREE.Mesh &&
          (!clipping() || clipping()!.distanceToPoint(item.point) >= 0),
      );
    const plane = raycaster
      .intersectObjects(planes.children)
      .find((item) => item.object instanceof THREE.Mesh);
    if (plane && (!body || plane.distance + 1e-5 < body.distance))
      return {
        body: false,
        choice: choices.find(
          (choice) => choice.id === plane.object.userData.choiceId,
        ),
      };
    if (body) {
      const normal = body.face?.normal
        .clone()
        .transformDirection(body.object.matrixWorld);
      return {
        body: true,
        choice: normal
          ? faceChoiceAt(
              choices,
              body.object.userData.bodyId,
              body.point,
              normal,
            )
          : undefined,
      };
    }
    return {
      body: false,
      choice: choices.find(
        (choice) => choice.id === plane?.object.userData.choiceId,
      ),
    };
  };
  let hoverFrame = 0;
  let pendingPointer: Pick<MouseEvent, "clientX" | "clientY"> | undefined;
  const move = (event: MouseEvent) => {
    if (!active() || event.buttons) return;
    pendingPointer = { clientX: event.clientX, clientY: event.clientY };
    if (hoverFrame) return;
    hoverFrame = requestAnimationFrame(() => {
      hoverFrame = 0;
      if (!active() || !pendingPointer) return;
      const choice = hit(pendingPointer).choice;
      if (useSketchPlanePicker.getState().hover?.id !== choice?.id)
        useSketchPlanePicker.setState({ hover: choice });
    });
  };
  const leave = () => {
    pendingPointer = undefined;
    if (active()) useSketchPlanePicker.setState({ hover: undefined });
  };
  const down = (event: PointerEvent) => {
    pendingPointer = undefined;
    cancelAnimationFrame(hoverFrame);
    hoverFrame = 0;
    if (active()) useSketchPlanePicker.setState({ hover: undefined });
    pointerDown =
      event.button === 0 ? { x: event.clientX, y: event.clientY } : undefined;
  };
  const click = (event: MouseEvent) => {
    const press = pointerDown;
    pointerDown = undefined;
    const workflow = active();
    if (!workflow) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (
      event.button !== 0 ||
      (press &&
        Math.hypot(event.clientX - press.x, event.clientY - press.y) > 4)
    )
      return;
    const selected = hit(event);
    if (!selected.choice) {
      useSketchPlanePicker.setState({
        error: selected.body
          ? "This face is curved, modified, ambiguous, or not a supported native distance-extrusion face. Choose a highlighted origin plane or supported face."
          : "Click a visible origin plane or supported planar face.",
      });
      return;
    }
    try {
      finishProjectWorkflow(workflow, selected.choice.reference);
    } catch (error) {
      useSketchPlanePicker.setState({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
  const unsubs = [
    useCadStore.subscribe(refresh),
    useProjectWorkflow.subscribe(refresh),
    useSketchPlanePicker.subscribe(hovered),
  ];
  renderer.domElement.addEventListener("pointermove", move);
  renderer.domElement.addEventListener("pointerleave", leave);
  renderer.domElement.addEventListener("pointerdown", down);
  renderer.domElement.addEventListener("click", click, true);
  refresh();
  return () => {
    cancelAnimationFrame(hoverFrame);
    unsubs.forEach((unsubscribe) => unsubscribe());
    renderer.domElement.removeEventListener("pointermove", move);
    renderer.domElement.removeEventListener("pointerleave", leave);
    renderer.domElement.removeEventListener("pointerdown", down);
    renderer.domElement.removeEventListener("click", click, true);
    clear(planes);
    clear(highlight);
    scene.remove(planes, highlight);
  };
}
