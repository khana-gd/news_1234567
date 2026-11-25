export interface YouTubeVideo {
  video_id: string;
  title: string;
  published: string;
  thumbnail: string;
  url: string;
}

// ── Dual-mode API ────────────────────────────────────────────────────────────
// LOCAL  : calls our FastAPI proxy at EXPO_PUBLIC_BACKEND_URL/api/*
// PROD APK: calls WordPress REST API directly at EXPO_PUBLIC_API_URL/*
const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL || 'https://public-samachar-api.onrender.com';
const WP_API = process.env.EXPO_PUBLIC_API_URL || 'https://mypublicsamachar.com/wp-json/wp/v2';
const USE_WP_DIRECT = true;
// YouTube RSS — direct fetch in production (no backend needed)
const YT_CHANNEL_ID = process.env.EXPO_PUBLIC_YT_CHANNEL_ID || 'UC8NATKQsfiBH78KT0symldg';
const YT_RSS = `https://www.youtube.com/feeds/videos.xml?channel_id=${YT_CHANNEL_ID}`;

// \u2500\u2500 YouTube RSS parser (no external library needed) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
const parseYTRSS = (xml: string): YouTubeVideo[] => {
  const tag = (name: string) => new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`, 'g');
  const ids = [...xml.matchAll(/<yt:videoId>([^<]+)<\/yt:videoId>/g)].map(m => m[1]);
  const allTitles = [...xml.matchAll(/<title>([^<]+)<\/title>/g)].map(m => m[1]);
  const dates = [...xml.matchAll(/<published>([^<]+)<\/published>/g)].map(m => m[1]);
  const thumbs = [...xml.matchAll(/media:thumbnail url="([^"]+)"/g)].map(m => m[1]);
  return ids.map((id, i) => ({
    video_id: id,
    title: allTitles[i + 1] || '',   // index 0 is the channel title
    published: dates[i] || '',
    thumbnail: thumbs[i] || `https://img.youtube.com/vi/${id}/hqdefault.jpg`,
    url: `https://www.youtube.com/watch?v=${id}`,
  }));
};

export interface Post {
  id: number;
  slug: string;
  title: string;
  excerpt: string;
  content: string;
  date: string;
  modified: string;
  featured_image: string | null;
  categories: number[];
  category_names: { id: number; name: string; slug: string }[];
  author: string;
  link: string;
  comment_count: number;
  status: string;
  mps_clean_content?: string;
  mps_reporter_name?: string;
  mps_ai_summary?: string[];
  mps_featured_image?: string | null;
}

export interface Category {
  id: number;
  name: string;
  slug: string;
  count: number;
}

export interface WPVideoItem {
  id: number;
  title: string;
  caption:      string;
  url:          string;     // direct .mp4 URL (empty for YouTube-only items)
  mime_type:    string;
  date:         string;
  link:         string;     // article / YouTube link
  location?:    string;     // location tag
  youtubeUrl?:  string;     // YouTube watch URL
  thumbnail?:   string;     // YouTube thumbnail (or WP featured image)
  source?:      'wordpress' | 'youtube'; // origin feed
}

export interface PostsResponse {
  posts: Post[];
  total: number;
  total_pages: number;
  current_page: number;
}

const fetchJson = async (url: string, options?: RequestInit) => {
  const resp = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
};

// ── WordPress raw → Post ──────────────────────────────────────────────────────
const parseWPPost = (p: any): Post => {
  const sizes = p._embedded?.['wp:featuredmedia']?.[0]?.media_details?.sizes || {};
  const embeddedImage =
    sizes.medium?.source_url ||
    sizes.medium_large?.source_url ||
    sizes.thumbnail?.source_url ||
    p._embedded?.['wp:featuredmedia']?.[0]?.source_url ||
    null;
  let featuredImage = p.mps_featured_image || embeddedImage;

  // Filter out .svg or fallback-thumb.svg to let mobile app use crisp bundled local placeholder
  if (
    featuredImage &&
    typeof featuredImage === 'string' &&
    (featuredImage.endsWith('.svg') || featuredImage.includes('fallback-thumb.svg'))
  ) {
    featuredImage = null;
  }

  const categoryTerms: any[] = p._embedded?.['wp:term']?.[0] || [];
  const decodeEntities = (str: string) =>
    str.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
       .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;/g, "'");

  // Clean content: prefer mps_clean_content, fallback to content.rendered with regex stripping ads and carriage returns
  const rawContent = p.mps_clean_content || p.content?.rendered || '';
  const mpsCleanContent = String(rawContent)
    .replace(/\[ad[_-]?\d+\]/gi, '')
    .replace(/\\r\\n|\\r|\\n|\r/g, '\n')
    .trim();

  // Reporter name: prefer mps_reporter_name, fallback to author embedded name or 'ಸುದ್ದಿ ಡೆಸ್ಕ್'
  const mpsReporterName = p.mps_reporter_name || p._embedded?.author?.[0]?.name || 'ಸುದ್ದಿ ಡೆಸ್ಕ್';

  // AI summary: array of 3 bullet points
  let mpsAiSummary: string[] = [];
  if (Array.isArray(p.mps_ai_summary)) {
    mpsAiSummary = p.mps_ai_summary.map((s: any) => String(s).trim()).filter(Boolean);
  } else if (typeof p.mps_ai_summary === 'string' && p.mps_ai_summary.trim()) {
    mpsAiSummary = p.mps_ai_summary
      .split(/\r?\n|•|\*/)
      .map((s: string) => s.trim())
      .filter((s: string) => s.length > 0);
  }

  return {
    id: p.id,
    slug: p.slug || '',
    title: decodeEntities(p.title?.rendered || ''),
    excerpt: p.excerpt?.rendered || '',
    content: mpsCleanContent,
    date: p.date || '',
    modified: p.modified || '',
    featured_image: featuredImage,
    categories: p.categories || [],
    category_names: categoryTerms.map((t: any) => ({ id: t.id, name: t.name, slug: t.slug })),
    author: mpsReporterName,
    link: p.link || '',
    comment_count: Number(p.comment_count) || 0,
    status: p.status || 'publish',
    mps_clean_content: mpsCleanContent,
    mps_reporter_name: mpsReporterName,
    mps_ai_summary: mpsAiSummary,
    mps_featured_image: featuredImage,
  };
};

// ── WordPress direct fetcher ──────────────────────────────────────────────────
const wpGetPosts = async (
  page = 1,
  perPage = 10,
  categoryId?: number | null,
  orderby = 'date',
  search?: string,
): Promise<PostsResponse> => {
  const params = new URLSearchParams({
    _embed: '1',
    per_page: String(perPage),
    page: String(page),
    orderby,
    order: 'desc',
  });
  if (categoryId) params.append('categories', String(categoryId));
  if (search) params.append('search', search);
  const resp = await fetch(`${WP_API}/posts?${params}`);
  if (!resp.ok) throw new Error(`WP API HTTP ${resp.status}`);
  const totalPages = parseInt(resp.headers.get('X-WP-TotalPages') || '1', 10);
  const total = parseInt(resp.headers.get('X-WP-Total') || '0', 10);
  const data = await resp.json();
  return {
    posts: (data as any[]).map(parseWPPost),
    total,
    total_pages: totalPages,
    current_page: page,
  };
};

// ── Unified API ───────────────────────────────────────────────────────────────
export const api = {
  getPosts: (page = 1, perPage = 10, categoryId?: number | null, orderby = 'date'): Promise<PostsResponse> => {
    if (USE_WP_DIRECT) return wpGetPosts(page, perPage, categoryId, orderby);
    const params = new URLSearchParams({ page: String(page), per_page: String(perPage), orderby });
    if (categoryId) params.append('category_id', String(categoryId));
    return fetchJson(`${BACKEND_URL}/api/posts?${params}`);
  },

  getCategories: async (): Promise<Category[]> => {
    if (USE_WP_DIRECT) {
      try {
        const data = await fetchJson(`${WP_API}/categories?per_page=100&orderby=count&order=desc`);
        if (Array.isArray(data) && data.length > 0) {
          return data.map((c: any) => ({
            id: c.id,
            name: c.name,
            slug: c.slug,
            count: Number(c.count) || 0,
          }));
        }
      } catch (err) {
        console.warn('WP getCategories failed, falling back to backend:', err);
      }
    }
    return fetchJson(`${BACKEND_URL}/api/categories`).catch(() => []);
  },

  getStories: async (): Promise<Post[]> => {
    try {
      if (USE_WP_DIRECT) {
        const resp = await wpGetPosts(1, 15, null, 'date');
        return resp.posts.filter(p => !!p.featured_image);
      }
      // Try local backend first
      const localStories = await fetchJson(`${BACKEND_URL}/api/stories`).catch(() => null);
      if (localStories && Array.isArray(localStories) && localStories.length > 0) {
        return localStories;
      }
      // Fallback: direct WP fetch when backend doesn't serve /api/stories
      const wpResp = await wpGetPosts(1, 15, null, 'date').catch(() => null);
      if (wpResp && wpResp.posts.length > 0) {
        return wpResp.posts.filter(p => !!p.featured_image);
      }
    } catch (e) {
      console.error('getStories error:', e);
    }
    return [];
  },

  search: async (q: string, page = 1): Promise<{ posts: Post[]; total: number }> => {
    if (USE_WP_DIRECT) {
      const resp = await wpGetPosts(page, 20, null, 'relevance', q);
      return { posts: resp.posts, total: resp.total };
    }
    const params = new URLSearchParams({ q, page: String(page) });
    return fetchJson(`${BACKEND_URL}/api/search?${params}`);
  },

  getTrending: async (page = 1, categoryId?: number | null): Promise<{ posts: Post[]; total: number }> => {
    if (USE_WP_DIRECT) {
      const resp = await wpGetPosts(page, 10, categoryId, 'date');
      return { posts: resp.posts, total: resp.total };
    }
    const params = new URLSearchParams({ page: String(page) });
    if (categoryId) params.append('category_id', String(categoryId));
    return fetchJson(`${BACKEND_URL}/api/trending?${params}`);
  },

  getVideos: async (page = 1, categoryId?: number | null): Promise<{ posts: Post[]; total: number }> => {
    // If specific category requested or direct WP mode, get WP posts for video-feed (cat 92) or specified category
    const cat = categoryId || 92;
    try {
      const resp = await wpGetPosts(page, 15, cat, 'date');
      if (resp && resp.posts.length > 0) return resp;
    } catch {}
    const params = new URLSearchParams({ page: String(page) });
    if (categoryId) params.append('category_id', String(categoryId));
    return fetchJson(`${BACKEND_URL}/api/videos?${params}`).catch(() => ({ posts: [], total: 0 }));
  },

  getPost: async (id: number): Promise<Post> => {
    if (USE_WP_DIRECT) {
      const data = await fetchJson(`${WP_API}/posts/${id}?_embed`);
      return parseWPPost(data);
    }
    return fetchJson(`${BACKEND_URL}/api/post/${id}`);
  },

  reportPost: (postId: number, reason: string, postTitle?: string) =>
    fetchJson(`${BACKEND_URL}/api/report-post`, {
      method: 'POST',
      body: JSON.stringify({ post_id: postId, reason, post_title: postTitle }),
    }),

  getYoutubeFeed: async (): Promise<{ videos: YouTubeVideo[]; channel_id?: string; channel_url?: string; error?: string }> => {
    // Always use the backend proxy — avoids CORS issues in web and on native
    try {
      const result = await fetchJson(`${BACKEND_URL}/api/youtube-feed`);
      return result;
    } catch {
      // Fallback: try direct RSS on native (no CORS restriction)
      if (USE_WP_DIRECT) {
        try {
          const resp = await fetch(YT_RSS);
          if (!resp.ok) throw new Error(`RSS HTTP ${resp.status}`);
          const xml = await resp.text();
          const videos = parseYTRSS(xml);
          return { videos, channel_id: YT_CHANNEL_ID, channel_url: `https://www.youtube.com/channel/${YT_CHANNEL_ID}` };
        } catch (e: any) {
          return { videos: [], error: String(e?.message || 'Failed to load YouTube feed') };
        }
      }
      return { videos: [], error: 'Failed to load YouTube feed' };
    }
  },

  getWPVideoFeed: async (page = 1): Promise<WPVideoItem[]> => {
    // 1. Direct WordPress fetch for category 92 (video-feed)
    try {
      const resp = await fetch(`${WP_API}/posts?categories=92&_embed=1&per_page=20&page=${page}`);
      if (resp.ok) {
        const posts = await resp.json();
        if (Array.isArray(posts) && posts.length > 0) {
          const items: WPVideoItem[] = [];
          for (const p of posts) {
            const raw = p.content?.rendered || '';
            const mp4Match = raw.match(/https?:\/\/[^\s"'<>]+\.(?:mp4|m3u8)/i);
            const ytMatch = raw.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]+)/i);
            const sizes = p._embedded?.['wp:featuredmedia']?.[0]?.media_details?.sizes || {};
            let thumb = sizes.medium?.source_url || sizes.thumbnail?.source_url || p.mps_featured_image || p._embedded?.['wp:featuredmedia']?.[0]?.source_url || '';
            if (thumb && (thumb.endsWith('.svg') || thumb.includes('fallback-thumb.svg'))) {
              thumb = '';
            }

            const decode = (s: string) =>
              s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
               .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;/g, "'");

            const url = mp4Match ? mp4Match[0] : '';
            const ytUrl = ytMatch ? `https://www.youtube.com/watch?v=${ytMatch[1]}` : undefined;
            if (url || ytUrl) {
              items.push({
                id: p.id,
                title: decode(p.title?.rendered || ''),
                caption: (p.excerpt?.rendered || '').replace(/<[^>]+>/g, '').trim(),
                url,
                mime_type: 'video/mp4',
                date: p.date || '',
                link: p.link || '',
                youtubeUrl: ytUrl,
                thumbnail: thumb,
                source: url ? 'wordpress' : 'youtube',
              });
            }
          }
          if (items.length > 0) return items;
        }
      }
    } catch (e) {
      console.warn('Direct WP video feed notice:', e);
    }

    // 2. Fallback to backend proxy if available
    try {
      return await fetchJson(`${BACKEND_URL}/api/wp-video-feed?page=${page}`);
    } catch {
      return [];
    }
  },

  submitVideo: async (title: string, description: string, videoUri: string, filename: string): Promise<{ success: boolean; post_id?: number }> => {
    const formData = new FormData();
    formData.append('title', title);
    formData.append('description', description);
    formData.append('video', { uri: videoUri, type: 'video/mp4', name: filename } as any);
    const resp = await fetch(`${BACKEND_URL}/api/submit-video`, { method: 'POST', body: formData });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.json();
  },

  submitPost: (title: string, content: string, imageBase64?: string, imageFilename?: string) =>
    fetchJson(`${BACKEND_URL}/api/submit-post`, {
      method: 'POST',
      body: JSON.stringify({ title, content, image_base64: imageBase64, image_filename: imageFilename }),
    }),
};

export const formatDate = (dateStr: string): string => {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = Math.floor((now.getTime() - d.getTime()) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return dateStr.split('T')[0];
  }
};
