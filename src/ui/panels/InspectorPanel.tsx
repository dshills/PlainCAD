import { useCadStore } from "../../state/useCadStore";

export function InspectorPanel() {
  const selection = useCadStore((state) => state.selection.selectedIds[0]);
  const document = useCadStore((state) => state.history.present);
  const body = useCadStore((state) => state.rebuild.result?.bodies.find((item) => item.id === selection?.id));
  const parameter = selection?.kind === "parameter" ? document.parameters[selection.id] : undefined;
  const sketch = selection?.kind === "sketch" ? document.sketches[selection.id] : undefined;
  const feature = selection?.kind === "feature" ? document.features.find((item) => item.id === selection.id) : undefined;

  return (
    <section className="panel">
      <h2>Inspector</h2>
      {!selection ? <p className="muted">Select a parameter, sketch, feature, or body.</p> : null}
      {parameter ? (
        <div className="item-card">
          <strong>{parameter.name}</strong>
          <p className="muted">{parameter.expression} = {parameter.value.toFixed(3)}{parameter.unit}</p>
        </div>
      ) : null}
      {sketch ? (
        <div className="item-card">
          <strong>{sketch.name}</strong>
          <p className="muted">Plane {sketch.plane}</p>
        </div>
      ) : null}
      {feature ? (
        <div className="item-card">
          <strong>{feature.name}</strong>
          <p className="muted">{feature.type}</p>
        </div>
      ) : null}
      {body ? (
        <div className="item-card">
          <strong>{body.name}</strong>
          <p className="muted">Generated from {body.featureId}</p>
        </div>
      ) : null}
    </section>
  );
}
