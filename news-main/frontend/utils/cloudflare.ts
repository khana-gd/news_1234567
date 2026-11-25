/**
 * Cloudflare / Backend API utilities
 * When CF Worker is deployed: change WORKER_URL to the Worker URL in eas.json
 * When R2 is enabled: the Worker handles direct R2 uploads
 */

const WORKER_URL =
  process.env.EXPO_PUBLIC_CF_WORKER_URL ||
  process.env.EXPO_PUBLIC_BACKEND_URL ||
  'https://public-samachar-api.onrender.com';

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

const WP_API_FALLBACK =
  process.env.EXPO_PUBLIC_API_URL || 'https://mypublicsamachar.com/wp-json/wp/v2';

export async function fetchCFVideos(page = 1, limit = 10): Promise<CFVideoItem[]> {
  // 1. Try Render / Cloudflare Worker video endpoint
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const resp = await fetch(`${WORKER_URL}/api/cf/videos?page=${page}&limit=${limit}`, {
      signal: ctrl.signal,
      headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' },
    });
    clearTimeout(timer);
    if (resp.ok) {
      const data = await resp.json();
      const vids = data.videos || (Array.isArray(data) ? data : []);
      if (Array.isArray(vids) && vids.length > 0) {
        return vids;
      }
    }
  } catch (e) {
    console.warn('fetchCFVideos backend notice:', e);
  }

  // 2. Fallback to direct WordPress Category 92 (video-feed)
  try {
    const wpResp = await fetch(
      `${WP_API_FALLBACK}/posts?categories=92&_embed=1&per_page=${limit}&page=${page}`,
      { headers: { Accept: 'application/json' } }
    );
    if (wpResp.ok) {
      const posts = await wpResp.json();
      if (Array.isArray(posts) && posts.length > 0) {
        const items: CFVideoItem[] = [];
        for (const p of posts) {
          const raw = p.content?.rendered || '';
          const mp4Match = raw.match(/https?:\/\/[^\s"'<>]+\.(?:mp4|m3u8)/i);
          const sizes = p._embedded?.['wp:featuredmedia']?.[0]?.media_details?.sizes || {};
          let thumb =
            sizes.medium?.source_url ||
            sizes.thumbnail?.source_url ||
            p.mps_featured_image ||
            p._embedded?.['wp:featuredmedia']?.[0]?.source_url ||
            '';
          if (thumb && (thumb.endsWith('.svg') || thumb.includes('fallback-thumb.svg'))) {
            thumb = '';
          }

          const decode = (s: string) =>
            s
              .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
              .replace(/&amp;/g, '&')
              .replace(/&lt;/g, '<')
              .replace(/&gt;/g, '>')
              .replace(/&quot;/g, '"')
              .replace(/&#039;/g, "'");

          const vidUrl = mp4Match ? mp4Match[0] : '';
          if (vidUrl) {
            items.push({
              id: `wp_${p.id}`,
              title: decode(p.title?.rendered || ''),
              description: (p.excerpt?.rendered || '').replace(/<[^>]+>/g, '').trim(),
              video_url: vidUrl,
              thumb_url: thumb,
              reporter_name: p.mps_reporter_name || p._embedded?.author?.[0]?.name || 'ಸುದ್ದಿ ಡೆಸ್ಕ್',
              reporter_id: `wp_author_${p.author || 1}`,
              timestamp: p.date ? new Date(p.date).getTime() : Date.now(),
              duration: 60,
              views: 1000,
            });
          }
        }
        if (items.length > 0) return items;
      }
    }
  } catch (wpe) {
    console.warn('fetchCFVideos WP fallback notice:', wpe);
  }

  return [];
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
