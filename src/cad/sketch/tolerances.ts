// Millimeters/radians. Sketch closure is stricter than OpenCascade's 1e-7 mm tolerance.
export const SKETCH_TOLERANCE = 1e-8;
export const SOLVE_TOLERANCE = 1e-9;
export const KERNEL_LINEAR_TOLERANCE = 1e-7;
export const MIN_ENTITY_SIZE = 1e-6;
export const ANGULAR_TOLERANCE = 1e-7;
export const SOLVER_LIMITS = {
  iterations: 100,
  elapsedMs: 50,
  variables: 160,
  equations: 512,
} as const;
