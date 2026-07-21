/**
 * YouTube Data API v3 — Resumable Upload Utility
 *
 * Flow:
 *  1. POST to initialise upload session → get Location (uploadUri)
 *  2. Native: FileSystem.createUploadTask (streams from disk, no RAM spike)
 *     Web:    XHR fallback
 *  3. Return the new YouTube video ID
 */
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';

export type YouTubeUploadConfig = {
  accessToken:  string;
  videoUri:     string;
  title:        string;
  description?: string;
  tags?:        string[];
  location?:    string;
  onProgress?:  (percent: number) => void;
};

export type YouTubeUploadResult = {
  videoId:  string;
  videoUrl: string;
};

export async function uploadToYouTube(
  config: YouTubeUploadConfig,
): Promise<YouTubeUploadResult> {
  const { accessToken, videoUri, title, description, tags, location, onProgress } = config;
  const IS_NATIVE = Platform.OS === 'ios' || Platform.OS === 'android';

  // ── Step 1: Get actual file size (needed by YouTube for Content-Length) ───
  let fileSize = 0;
  try {
    const info = await (FileSystem.getInfoAsync as any)(videoUri, { size: true });
    if (!info.exists) throw new Error('Video file not found: ' + videoUri);
    fileSize = info.size || 0;
  } catch (e: any) {
    if (IS_NATIVE) throw e;
    // web preview: continue without size
  }

  onProgress?.(5);

  // ── Step 2: Build video metadata snippet ───────────────────────────────────
  const snippet = {
    title,
    description: [
      description || title,
      location ? `📍 Location: ${location}` : '',
      '',
      '#PublicSamachar #KannadaNews #Karnataka',
    ].filter(Boolean).join('\n'),
    tags:            ['Public Samachar', 'Kannada News', ...(tags || [])],
    categoryId:      '25', // News & Politics
    defaultLanguage: 'kn',
  };

  // ── Step 3: Initialise the resumable upload session ───────────────────────
  const initHeaders: Record<string, string> = {
    Authorization:           `Bearer ${accessToken}`,
    'Content-Type':          'application/json; charset=UTF-8',
    'X-Upload-Content-Type': 'video/mp4',
  };
  if (fileSize > 0) {
    initHeaders['X-Upload-Content-Length'] = String(fileSize);
  }

  const initResp = await fetch(
    'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
    {
      method:  'POST',
      headers: initHeaders,
      body:    JSON.stringify({
        snippet,
        status: { privacyStatus: 'public', selfDeclaredMadeForKids: false },
      }),
    },
  );

  if (!initResp.ok) {
    const errText = await initResp.text();
    throw new Error(`YouTube init failed (${initResp.status}): ${errText.slice(0, 300)}`);
  }

  const uploadUri = initResp.headers.get('Location');
  if (!uploadUri) throw new Error('YouTube did not return an upload URI. Check OAuth scopes.');

  onProgress?.(10);

  // ── Step 4a: Native — FileSystem.createUploadTask (streams, no RAM spike) ─
  let videoId: string;

  if (IS_NATIVE) {
    videoId = await new Promise<string>((resolve, reject) => {
      try {
        const FS = FileSystem as any;
        const BINARY = FS.FileSystemUploadType?.BINARY_CONTENT ?? 1;

        const task = FS.createUploadTask(
          uploadUri,
          videoUri,
          {
            httpMethod:  'PUT',
            headers:     { 'Content-Type': 'video/mp4' },
            uploadType:  BINARY,
          },
          (data: { totalBytesSent: number; totalBytesExpectedToSend: number }) => {
            const expected = data.totalBytesExpectedToSend;
            if (expected > 0 && onProgress) {
              const pct = 10 + Math.round((data.totalBytesSent / expected) * 88);
              onProgress(Math.min(98, pct));
            }
          },
        );

        task.uploadAsync()
          .then((result: any) => {
            if (!result) { reject(new Error('No response from upload task.')); return; }
            if (result.status < 200 || result.status >= 300) {
              reject(new Error(`Upload HTTP ${result.status}: ${(result.body || '').slice(0, 300)}`));
              return;
            }
            try {
              const parsed = JSON.parse(result.body || '{}');
              if (parsed.id) resolve(parsed.id);
              else reject(new Error('YouTube response missing video ID. Body: ' + (result.body || '').slice(0, 200)));
            } catch {
              reject(new Error('Failed to parse YouTube upload response: ' + (result.body || '').slice(0, 200)));
            }
          })
          .catch((e: any) => reject(e));
      } catch (e: any) {
        reject(new Error('Failed to create upload task: ' + (e?.message || String(e))));
      }
    });
  } else {
    // ── Step 4b: Web / Expo-Go fallback — XHR ────────────────────────────────
    videoId = await new Promise<string>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', uploadUri, true);
      xhr.setRequestHeader('Content-Type', 'video/mp4');

      xhr.upload.onprogress = (evt) => {
        if (evt.lengthComputable && onProgress) {
          onProgress(10 + Math.round((evt.loaded / evt.total) * 88));
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const data = JSON.parse(xhr.responseText);
            if (data.id) resolve(data.id);
            else reject(new Error('YouTube response missing video ID.'));
          } catch {
            reject(new Error('Failed to parse YouTube upload response.'));
          }
        } else {
          reject(new Error(`Upload failed: HTTP ${xhr.status} — ${xhr.responseText.slice(0, 200)}`));
        }
      };

      xhr.onerror   = () => reject(new Error('Network error during YouTube upload.'));
      xhr.ontimeout = () => reject(new Error('Upload timed out after 2 hours.'));
      xhr.timeout   = 7200000; // 2-hour max for large files

      xhr.send({ uri: videoUri } as any);
    });
  }

  return {
    videoId,
    videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
  };
}
