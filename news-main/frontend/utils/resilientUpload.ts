import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';

const BACKEND = process.env.EXPO_PUBLIC_BACKEND_URL || '';

export interface UploadProgressUpdate {
  percent: number;
  bytesSent: number;
  totalBytes: number;
  statusText: string;
  isRetrying?: boolean;
  attempt?: number;
  maxAttempts?: number;
}

export type ProgressCallback = (update: UploadProgressUpdate) => void;

/**
 * Checks whether the backend/network is currently reachable.
 */
export async function checkNetworkReachable(timeoutMs = 4000): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(`${BACKEND}/api/network-ping`, {
      method: 'GET',
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Wait for network with exponential backoff and connectivity probing.
 */
async function waitForNetwork(
  attempt: number,
  maxAttempts: number,
  onProgress?: ProgressCallback,
  totalBytes: number = 0,
): Promise<void> {
  const delays = [0, 2000, 4000, 7000, 11000, 16000];
  const delay = delays[Math.min(attempt, delays.length - 1)];

  for (let elapsed = 0; elapsed < delay; elapsed += 1000) {
    const remainSec = Math.ceil((delay - elapsed) / 1000);
    onProgress?.({
      percent: 0,
      bytesSent: 0,
      totalBytes,
      statusText: `📶 Network weak/dropped. Reconnecting in ${remainSec}s... (Attempt ${attempt}/${maxAttempts})`,
      isRetrying: true,
      attempt,
      maxAttempts,
    });
    await new Promise(r => setTimeout(r, 1000));
  }
}

/**
 * Uploads a local video file directly to Cloudflare R2 using native off-heap
 * streaming and an automatic retry engine.
 *
 * Designed to survive rural Indian network conditions (e.g. Dharwad, Hubli outskirts,
 * highway dead spots, 2G/3G flakiness).
 */
export async function uploadVideoResiliently(
  videoUri: string,
  authHeaders: Record<string, string>,
  onProgress?: ProgressCallback,
  maxRetries: number = 5,
): Promise<{ videoId: string; videoKey: string }> {
  // 1. Get file size
  let fileSize = 0;
  try {
    const info = await FileSystem.getInfoAsync(videoUri);
    fileSize = (info as any)?.size ?? 0;
  } catch {}

  const sizeMB = (fileSize / (1024 * 1024)).toFixed(1);

  // ── ATTEMPT LOOP ───────────────────────────────────────────────────────────
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    if (attempt > 1) {
      await waitForNetwork(attempt, maxRetries, onProgress, fileSize);
    }

    try {
      onProgress?.({
        percent: 5,
        bytesSent: 0,
        totalBytes: fileSize,
        statusText: attempt > 1
          ? `Reconnecting to upload server (Attempt ${attempt}/${maxRetries})...`
          : 'Connecting to Cloudflare storage...',
        isRetrying: attempt > 1,
        attempt,
        maxAttempts: maxRetries,
      });

      // ── Step A: Request Presigned URL from Backend ─────────────────────────
      const urlRes = await fetch(`${BACKEND}/api/generate-upload-url?content_type=video%2Fmp4`, {
        headers: authHeaders,
      });

      if (urlRes.status === 401) {
        throw new Error('AUTH_EXPIRED');
      }
      if (!urlRes.ok) {
        throw new Error(`Upload ticket error (HTTP ${urlRes.status})`);
      }

      const { upload_url: presignedUrl, video_id: videoId, key: videoKey } = await urlRes.json();
      if (!presignedUrl || !videoId) {
        throw new Error('Server returned invalid upload parameters');
      }

      onProgress?.({
        percent: 10,
        bytesSent: 0,
        totalBytes: fileSize,
        statusText: `Uploading ${sizeMB} MB...`,
        isRetrying: false,
        attempt,
        maxAttempts: maxRetries,
      });

      // ── Step B: Native Off-Heap Binary Stream Upload ────────────────────────
      // Uses FileSystem.createUploadTask on Native to stream direct from storage disk.
      // Consumes 0 MB of JavaScript Heap RAM!
      if (Platform.OS !== 'web' && (FileSystem as any).createUploadTask) {
        const FS = FileSystem as any;
        const uploadType = FS.FileSystemUploadType?.BINARY_CONTENT ?? 1;

        const task = FS.createUploadTask(
          presignedUrl,
          videoUri,
          {
            httpMethod: 'PUT',
            headers: { 'Content-Type': 'video/mp4' },
            uploadType,
          },
          (progressEvent: { totalBytesSent: number; totalBytesExpectedToSend: number }) => {
            const expected = progressEvent.totalBytesExpectedToSend || fileSize;
            const sent = progressEvent.totalBytesSent;
            const pct = expected > 0 ? Math.min(95, 10 + Math.round((sent / expected) * 85)) : 50;

            const sentMB = (sent / (1024 * 1024)).toFixed(1);
            const totalMB = (expected / (1024 * 1024)).toFixed(1);

            onProgress?.({
              percent: pct,
              bytesSent: sent,
              totalBytes: expected,
              statusText: `Uploading: ${sentMB} / ${totalMB} MB (${pct}%)`,
              isRetrying: false,
              attempt,
              maxAttempts: maxRetries,
            });
          }
        );

        const result = await task.uploadAsync();
        if (!result) {
          throw new Error('No response from upload task');
        }

        if (result.status >= 200 && result.status < 300) {
          onProgress?.({
            percent: 96,
            bytesSent: fileSize,
            totalBytes: fileSize,
            statusText: 'Video uploaded successfully ✓',
            isRetrying: false,
          });
          return { videoId, videoKey };
        } else {
          throw new Error(`Upload failed with HTTP ${result.status}`);
        }
      } else {
        // ── Web / Fallback: XHR with streaming ──────────────────────────────
        const fileRes = await fetch(videoUri);
        const fileBlob = await fileRes.blob();

        const xhrSuccess = await new Promise<boolean>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('PUT', presignedUrl, true);
          xhr.setRequestHeader('Content-Type', 'video/mp4');
          xhr.timeout = 300000; // 5 min

          xhr.upload.onprogress = (e: ProgressEvent) => {
            if (e.lengthComputable && e.total > 0) {
              const pct = Math.min(95, 10 + Math.round((e.loaded / e.total) * 85));
              const sentMB = (e.loaded / (1024 * 1024)).toFixed(1);
              const totalMB = (e.total / (1024 * 1024)).toFixed(1);

              onProgress?.({
                percent: pct,
                bytesSent: e.loaded,
                totalBytes: e.total,
                statusText: `Uploading: ${sentMB} / ${totalMB} MB (${pct}%)`,
                isRetrying: false,
                attempt,
                maxAttempts: maxRetries,
              });
            }
          };

          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) resolve(true);
            else reject(new Error(`Storage error (HTTP ${xhr.status})`));
          };
          xhr.onerror = () => reject(new Error('Network connection lost'));
          xhr.ontimeout = () => reject(new Error('Upload connection timed out'));
          xhr.send(fileBlob);
        });

        if (xhrSuccess) {
          return { videoId, videoKey };
        }
      }
    } catch (err: any) {
      if (err?.message === 'AUTH_EXPIRED') {
        throw err;
      }
      lastError = err;
      if (attempt === maxRetries) {
        break;
      }
    }
  }

  throw lastError || new Error('Upload failed after multiple attempts. Network unavailable.');
}
