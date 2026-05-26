export function createId(prefix: string): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`;
  return `${prefix}_${random}`;
}
