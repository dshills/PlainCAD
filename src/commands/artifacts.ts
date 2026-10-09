export interface DownloadRequest {
  sequence: number;
  filename: string;
  type: string;
  bytes: number;
}
let sequence = 0;
const recent: DownloadRequest[] = [];
export function recordDownload(request: Omit<DownloadRequest, "sequence">) {
  recent.push({ ...request, sequence: ++sequence });
  if (recent.length > 64)
    recent.shift();
}
export function downloadRequests() { return { sequence, recent: recent.map(request => ({ ...request })) }; }
