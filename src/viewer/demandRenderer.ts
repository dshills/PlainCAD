/** Coalesce scene invalidations, continue while the camera settles, then release RAF. */
export class DemandRenderer {
  private frame: number | undefined;
  private disposed = false;
  private frames = 0;

  constructor(
    private readonly draw: () => boolean,
    private readonly request = (callback: FrameRequestCallback) => requestAnimationFrame(callback),
    private readonly cancel = (handle: number) => cancelAnimationFrame(handle),
  ) {}

  readonly invalidate = () => {
    if (this.disposed || this.frame !== undefined) return;
    this.frame = this.request(() => {
      this.frame = undefined;
      if (this.disposed) return;
      this.frames++;
      if (this.draw()) this.invalidate();
    });
  };

  inspect() { return { scheduled: this.frame !== undefined, frameCount: this.frames }; }

  dispose() {
    this.disposed = true;
    if (this.frame !== undefined) this.cancel(this.frame);
    this.frame = undefined;
  }
}
