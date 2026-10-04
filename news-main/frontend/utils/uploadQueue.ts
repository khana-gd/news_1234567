import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { optimizeVideoForUpload, QualityMode } from './videoOptimizer';
import { uploadVideoResiliently, checkNetworkReachable } from './resilientUpload';

const QUEUE_STORAGE_KEY = '@ps_offline_upload_queue_v2';
const BACKEND = process.env.EXPO_PUBLIC_BACKEND_URL || '';

// Permanent storage folder on device
const QUEUE_DIR = `${FileSystem.documentDirectory || ''}queued_uploads/`;

export interface QueuedUploadItem {
  id: string;
  title: string;
  description: string;
  location: string;
  reporterName: string;
  reporterId: string;
  aspectRatio: string;
  videoUri: string;
  thumbUri?: string;
  qualityMode: QualityMode;
  createdAt: number;
  status: 'queued' | 'optimizing' | 'uploading' | 'failed' | 'done';
  progress: number;
  progressMsg: string;
  error?: string;
  retryCount: number;
}

type QueueListener = (items: QueuedUploadItem[]) => void;
const listeners: Set<QueueListener> = new Set();
let isProcessingQueue = false;

function notifyListeners(items: QueuedUploadItem[]) {
  listeners.forEach(fn => {
    try { fn(items); } catch {}
  });
}

/**
 * Ensures the queued_uploads directory exists in permanent document storage.
 */
async function ensureQueueDirExists() {
  if (Platform.OS !== 'web' && QUEUE_DIR) {
    try {
      const dirInfo = await FileSystem.getInfoAsync(QUEUE_DIR);
      if (!dirInfo.exists) {
        await FileSystem.makeDirectoryAsync(QUEUE_DIR, { intermediates: true });
      }
    } catch {}
  }
}

/**
 * Retrieves all items currently in the upload queue.
 */
export async function getQueue(): Promise<QueuedUploadItem[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

/**
 * Saves updated queue items to AsyncStorage and notifies subscribers.
 */
async function saveQueue(items: QueuedUploadItem[]): Promise<void> {
  try {
    await AsyncStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(items));
    notifyListeners(items);
  } catch {}
}

/**
 * Updates a specific queue item by id.
 */
async function updateQueueItem(id: string, updates: Partial<QueuedUploadItem>): Promise<void> {
  const current = await getQueue();
  const updated = current.map(item => item.id === id ? { ...item, ...updates } : item);
  await saveQueue(updated);
}

/**
 * Subscribes a React component to queue changes (e.g. for banners, modals, badges).
 */
export function subscribeToQueue(listener: QueueListener): () => void {
  listeners.add(listener);
  getQueue().then(items => listener(items)).catch(() => {});
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Enqueues a video to the offline queue.
 * Copies the video to permanent storage so it is never deleted by OS cache clearing.
 */
export async function enqueueUpload(params: {
  videoUri: string;
  title: string;
  description: string;
  location: string;
  reporterName?: string;
  reporterId?: string;
  aspectRatio?: string;
  thumbUri?: string;
  qualityMode?: QualityMode;
}): Promise<QueuedUploadItem> {
  await ensureQueueDirExists();

  const id = `upload_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  let permanentVideoUri = params.videoUri;

  if (Platform.OS !== 'web' && QUEUE_DIR) {
    try {
      permanentVideoUri = `${QUEUE_DIR}${id}.mp4`;
      await FileSystem.copyAsync({
        from: params.videoUri,
        to: permanentVideoUri,
      });
    } catch {
      permanentVideoUri = params.videoUri;
    }
  }

  const newItem: QueuedUploadItem = {
    id,
    title: params.title.trim(),
    description: params.description.trim(),
    location: params.location.trim(),
    reporterName: params.reporterName || 'Public Samachar Reporter',
    reporterId: params.reporterId || `reporter_${Date.now()}`,
    aspectRatio: params.aspectRatio || '16:9',
    videoUri: permanentVideoUri,
    thumbUri: params.thumbUri,
    qualityMode: params.qualityMode || 'rural',
    createdAt: Date.now(),
    status: 'queued',
    progress: 0,
    progressMsg: 'Queued for upload (Waiting for network...)',
    retryCount: 0,
  };

  const current = await getQueue();
  current.push(newItem);
  await saveQueue(current);

  // Trigger processor in background
  setTimeout(() => processNextInQueue().catch(() => {}), 200);

  return newItem;
}

/**
 * Removes an item from the queue and cleans up local storage.
 */
export async function removeQueueItem(id: string): Promise<void> {
  const current = await getQueue();
  const target = current.find(i => i.id === id);
  if (target?.videoUri && Platform.OS !== 'web' && target.videoUri.includes('queued_uploads')) {
    try {
      await FileSystem.deleteAsync(target.videoUri, { idempotent: true });
    } catch {}
  }
  const remaining = current.filter(i => i.id !== id);
  await saveQueue(remaining);
}

/**
 * Retries a failed or paused queue item.
 */
export async function retryQueueItem(id: string): Promise<void> {
  await updateQueueItem(id, {
    status: 'queued',
    progress: 0,
    progressMsg: 'Preparing retry...',
    error: undefined,
  });
  processNextInQueue().catch(() => {});
}

/**
 * Processes the next item in the queue.
 * Uploads 1 item at a time so it never chokes slow rural bandwidth!
 */
export async function processNextInQueue(): Promise<boolean> {
  if (isProcessingQueue) return false;

  const current = await getQueue();
  const candidate = current.find(item => item.status === 'queued' || item.status === 'failed');
  if (!candidate) return false;

  // Check if network is alive
  const isOnline = await checkNetworkReachable(3000);
  if (!isOnline) {
    await updateQueueItem(candidate.id, {
      progressMsg: '📶 Waiting for internet signal in your area...',
    });
    return false;
  }

  // Check JWT
  const jwtToken = await AsyncStorage.getItem('reporter_jwt_token').catch(() => null);
  if (!jwtToken) {
    await updateQueueItem(candidate.id, {
      status: 'failed',
      error: 'Reporter login required to complete upload.',
      progressMsg: 'Reporter login required',
    });
    return false;
  }

  isProcessingQueue = true;

  try {
    // ── 1. Optimizing / Compressing Video ────────────────────────────────────
    await updateQueueItem(candidate.id, {
      status: 'optimizing',
      progress: 5,
      progressMsg: candidate.qualityMode === 'rural'
        ? 'Optimizing video for Rural/Weak Network...'
        : 'Compressing video...',
    });

    const optResult = await optimizeVideoForUpload(
      candidate.videoUri,
      candidate.qualityMode,
      (pct, txt) => {
        updateQueueItem(candidate.id, {
          progress: Math.min(25, 5 + Math.round(pct * 0.2)),
          progressMsg: txt,
        }).catch(() => {});
      }
    );

    // ── 2. Resilient Streaming Upload ────────────────────────────────────────
    await updateQueueItem(candidate.id, {
      status: 'uploading',
      progress: 25,
      progressMsg: 'Connecting to storage...',
    });

    const authHeaders = { Authorization: `Bearer ${jwtToken}` };

    const { videoId, videoKey } = await uploadVideoResiliently(
      optResult.uri,
      authHeaders,
      (u) => {
        const mappedPct = 25 + Math.round((u.percent / 100) * 60); // 25% → 85%
        updateQueueItem(candidate.id, {
          progress: mappedPct,
          progressMsg: u.statusText,
        }).catch(() => {});
      },
      5
    );

    // ── 3. Thumbnail (Optional) ──────────────────────────────────────────────
    await updateQueueItem(candidate.id, {
      progress: 88,
      progressMsg: 'Processing thumbnail...',
    });

    let thumbKey = '';
    // If thumbnail was provided or can be uploaded
    try {
      if (candidate.thumbUri) {
        const thumbUrlRes = await fetch(`${BACKEND}/api/generate-thumb-url`, {
          headers: authHeaders,
        });
        if (thumbUrlRes.ok) {
          const { upload_url: thumbUrl, key: tk } = await thumbUrlRes.json();
          if (thumbUrl && tk) {
            const thumbBlob = await fetch(candidate.thumbUri).then(r => r.blob());
            const thumbXhr = new XMLHttpRequest();
            thumbXhr.open('PUT', thumbUrl, false);
            thumbXhr.setRequestHeader('Content-Type', 'image/jpeg');
            thumbXhr.send(thumbBlob);
            thumbKey = tk;
          }
        }
      }
    } catch {}

    // ── 4. Save D1 Metadata ──────────────────────────────────────────────────
    await updateQueueItem(candidate.id, {
      progress: 93,
      progressMsg: 'Publishing to feed...',
    });

    const metaRes = await fetch(`${BACKEND}/api/cf/save-video-meta`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({
        video_id: videoId,
        video_key: videoKey,
        title: candidate.title,
        description: candidate.description,
        location: candidate.location,
        reporter_name: candidate.reporterName,
        reporter_id: candidate.reporterId,
        thumb_key: thumbKey,
        aspect_ratio: candidate.aspectRatio,
      }),
    });

    if (!metaRes.ok) {
      const errTxt = await metaRes.text().catch(() => '');
      throw new Error(`Failed to save metadata (${metaRes.status}): ${errTxt.slice(0, 100)}`);
    }

    // ── 5. Clean up completed item ───────────────────────────────────────────
    await updateQueueItem(candidate.id, {
      status: 'done',
      progress: 100,
      progressMsg: 'Published successfully! ✓',
    });

    // Delete local permanent file
    try {
      if (candidate.videoUri.includes('queued_uploads')) {
        await FileSystem.deleteAsync(candidate.videoUri, { idempotent: true });
      }
      if (optResult.uri !== candidate.videoUri) {
        await FileSystem.deleteAsync(optResult.uri, { idempotent: true });
      }
    } catch {}

    // Remove from queue after a short delay so user sees "Done" status
    setTimeout(async () => {
      await removeQueueItem(candidate.id);
      // Process next item if any
      processNextInQueue().catch(() => {});
    }, 2000);

    return true;
  } catch (e: any) {
    const errorMsg = e?.message || 'Upload failed. Will auto-retry when network improves.';
    await updateQueueItem(candidate.id, {
      status: 'failed',
      error: errorMsg,
      progressMsg: `Upload paused: ${errorMsg}`,
      retryCount: candidate.retryCount + 1,
    });
    return false;
  } finally {
    isProcessingQueue = false;
  }
}

/**
 * Starts a background sync timer that automatically uploads pending items
 * whenever network is available (e.g. user drives into Dharwad/Hubli or reaches Wi-Fi).
 */
export function startQueueSyncWatcher(): () => void {
  const interval = setInterval(async () => {
    try {
      const items = await getQueue();
      const hasPending = items.some(i => i.status === 'queued' || i.status === 'failed');
      if (hasPending && !isProcessingQueue) {
        const online = await checkNetworkReachable(2500);
        if (online) {
          processNextInQueue().catch(() => {});
        }
      }
    } catch {}
  }, 15000); // Check every 15 seconds

  return () => clearInterval(interval);
}
