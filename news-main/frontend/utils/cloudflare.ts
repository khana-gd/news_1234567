/**
 * Cloudflare / Backend API utilities
 * When CF Worker is deployed: change WORKER_URL to the Worker URL in eas.json
 * When R2 is enabled: the Worker handles direct R2 uploads
 */

const WORKER_URL =
  process.env.EXPO_PUBLIC_CF_WORKER_URL ||
  process.env.EXPO_PUBLIC_BACKEND_URL ||
  '';

// ── Types ────────────────────────────────────────────────────────────────

export interface CFVideoItem {
  id: string;
  title: string;
  description: string;
  video_url: string;
  thumb_url: string;
  reporter_name: string;
  reporter_id: string;
  timestamp: number;      // Unix ms
  duration: number;
  views: number;
}

export interface CFProfile {
  id: string;
  display_name: string;
  location: string;
  profile_pic_url: string;
  is_reporter: number;    // 0 or 1
}

export interface TikTokItem {
  id: string;
  title: string;
  description: string;
  videoUrl: string;       // MP4 URL — empty for YouTube
  thumbUrl: string;
  reporterName: string;
  reporterAvatar: string;
  timestamp: number;
  youtubeId?: string;     // If YouTube source
  source: 'cloudflare' | 'youtube' | 'wordpress';
  cfId?: string;          // CF video ID for share/OG
  originalId?: number;    // For WP posts (comments)
}

// ── Converters ───────────────────────────────────────────────────────────

export function cfToTikTok(v: CFVideoItem): TikTokItem {
  return {
    id: v.id,
    title: v.title,
    description: v.description || '',
    videoUrl: v.video_url,
    thumbUrl: v.thumb_url || '',
    reporterName: v.reporter_name || 'Reporter',
    reporterAvatar: '',
    timestamp: v.timestamp,
    source: 'cloudflare',
    cfId: v.id,
  };
}

export function ytToTikTok(v: {
  video_id: string;
  title: string;
  description?: string;
  thumbnail: string;
  published?: string;
}): TikTokItem {
  return {
    id: `yt_${v.video_id}`,
    title: v.title,
    description: v.description || '',
    videoUrl: '',
    thumbUrl: v.thumbnail,
    reporterName: 'Public Samachar',
    reporterAvatar: '',
    timestamp: v.published ? new Date(v.published).getTime() : Date.now(),
    youtubeId: v.video_id,
    source: 'youtube',
  };
}

// ── API calls ────────────────────────────────────────────────────────────

export async function fetchCFVideos(page = 1, limit = 10): Promise<CFVideoItem[]> {
  try {
    const resp = await fetch(`${WORKER_URL}/api/cf/videos?page=${page}&limit=${limit}`);
    if (!resp.ok) return [];
    const data = await resp.json();
    return data.videos || [];
  } catch {
    return [];
  }
}

export async function fetchCFProfile(profileId: string): Promise<CFProfile | null> {
  try {
    const resp = await fetch(`${WORKER_URL}/api/cf/profile/${profileId}`);
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

export async function saveCFProfile(profile: Partial<CFProfile> & { id: string }): Promise<boolean> {
  try {
    const resp = await fetch(`${WORKER_URL}/api/cf/profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(profile),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

export function getCFOGUrl(cfId: string): string {
  return `${WORKER_URL}/api/cf/share/${cfId}`;
}

export function getCFShareUrl(item: TikTokItem): string {
  if (item.source === 'youtube' && item.youtubeId) {
    return `https://www.youtube.com/watch?v=${item.youtubeId}`;
  }
  if (item.cfId) {
    return getCFOGUrl(item.cfId);
  }
  return 'https://mypublicsamachar.com';
}
