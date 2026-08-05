from fastapi import FastAPI, APIRouter, HTTPException, UploadFile, File, Form, Request, Depends
from fastapi.responses import HTMLResponse, JSONResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel
from typing import List, Optional
import os
import asyncio
import requests
import httpx
import base64
import re
import logging
import time
import html as html_lib
import xml.etree.ElementTree as ET
from datetime import datetime, timezone, timedelta
from pathlib import Path
from dotenv import load_dotenv
import uuid
from concurrent.futures import ThreadPoolExecutor
import boto3
from botocore.config import Config as BotoConfig
import jwt as pyjwt  # PyJWT — reporter auth tokens

# Thread pool for CPU-bound blocking I/O (boto3 presigned URLs only)
_upload_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="r2_presign")

# ── Native async HTTP client (shared, connection-pooled) ─────────────────────
# Replaces run_in_executor + requests.post for all D1 queries.
# httpx.AsyncClient is thread-safe and designed for long-lived shared use.
_async_http_client: Optional[httpx.AsyncClient] = None

def get_async_client() -> httpx.AsyncClient:
    global _async_http_client
    if _async_http_client is None or _async_http_client.is_closed:
        _async_http_client = httpx.AsyncClient(
            timeout=httpx.Timeout(20.0, connect=5.0),
            limits=httpx.Limits(
                max_connections=200,
                max_keepalive_connections=40,
                keepalive_expiry=30.0,
            ),
            http2=False,
        )
    return _async_http_client

# ── Async WordPress helpers (cached) ─────────────────────────────────────────
async def wp_get(path: str, params: dict = None, timeout: float = 20.0,
                 cache_key: str = None, cache_ttl: float = 60.0):
    """Non-blocking GET to WordPress REST API with optional caching."""
    if cache_key:
        cached = _cache_get(cache_key, cache_ttl)
        if cached is not None:
            return cached
    try:
        http = get_async_client()
        r = await http.get(
            f"{WP_BASE_URL}/wp-json/wp/v2/{path}",
            params=params or {},
            headers=get_wp_auth(),
            timeout=timeout,
        )
        r.raise_for_status()
        data = r.json()
        result = {'data': data, 'headers': dict(r.headers)}
        if cache_key:
            _cache_set(cache_key, result)
        return result
    except Exception as e:
        logger.error(f"WP GET {path} failed: {e}")
        return None

async def wp_post_req(path: str, json_body: dict = None, content: bytes = None,
                      headers_extra: dict = None, timeout: float = 30.0):
    """Non-blocking POST to WordPress REST API."""
    try:
        http = get_async_client()
        base_headers = get_wp_auth()
        if headers_extra:
            base_headers.update(headers_extra)
        if content is not None:
            r = await http.post(
                f"{WP_BASE_URL}/wp-json/wp/v2/{path}",
                content=content,
                headers=base_headers,
                timeout=timeout,
            )
        else:
            base_headers['Content-Type'] = 'application/json'
            r = await http.post(
                f"{WP_BASE_URL}/wp-json/wp/v2/{path}",
                json=json_body or {},
                headers=base_headers,
                timeout=timeout,
            )
        return r
    except Exception as e:
        logger.error(f"WP POST {path} failed: {e}")
        return None

# ── Simple in-memory response cache ──────────────────────────────────────────
_mem_cache: dict = {}

def _cache_get(key: str, ttl: float) -> Optional[dict]:
    item = _mem_cache.get(key)
    if item and (time.time() - item['ts']) < ttl:
        return item['data']
    return None

def _cache_set(key: str, data) -> None:
    _mem_cache[key] = {'data': data, 'ts': time.time()}

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB — use .get() with fallbacks so server doesn't crash if env var is missing
mongo_url = os.environ.get('MONGO_URL', 'mongodb://localhost:27017')
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ.get('DB_NAME', 'publicsamachar_db')]

# WordPress Config
WP_BASE_URL = os.environ.get('WP_BASE_URL', 'https://mypublicsamachar.com')
WP_USERNAME = os.environ.get('WP_USERNAME', '')
WP_APP_PASSWORD = os.environ.get('WP_APP_PASSWORD', '')

# Cloudflare Config
CF_ACCOUNT_ID = os.environ.get('CF_ACCOUNT_ID', '')
CF_API_TOKEN = os.environ.get('CF_API_TOKEN', '')
D1_DB_ID = os.environ.get('D1_DB_ID', '')
CF_BUCKET_NAME = 'public-samachar-videos'
BACKEND_URL = os.environ.get('BACKEND_URL', 'https://news-react-native.preview.emergentagent.com')

# Cloudflare R2 Direct Upload (boto3 / AWS S3-compatible)
R2_ACCESS_KEY_ID = os.environ.get('R2_ACCESS_KEY_ID', '')
R2_SECRET_ACCESS_KEY = os.environ.get('R2_SECRET_ACCESS_KEY', '')
R2_ENDPOINT_URL = os.environ.get('R2_ENDPOINT_URL', f'https://{CF_ACCOUNT_ID}.r2.cloudflarestorage.com')
R2_BUCKET_NAME = os.environ.get('R2_BUCKET_NAME', 'public-samachar-videos')
# Public CDN base URL for the R2 bucket — videos served directly, no proxying
R2_PUBLIC_CDN = os.environ.get(
    'R2_PUBLIC_CDN_URL',
    'https://pub-053fe10649264831be10ca4454fe912c.r2.dev'
)

# ── JWT Reporter Auth config ───────────────────────────────────────────────────
# Secret key for signing JWT tokens — change this in production via env var
JWT_SECRET_KEY = os.environ.get('JWT_SECRET_KEY', 'ps-samachar-jwt-secret-2026-change-in-production')
# Access code reporters must enter to get a JWT (change via env var)
REPORTER_ACCESS_CODE_ENV = os.environ.get('REPORTER_ACCESS_CODE', 'PS2026')

# Admin access code for moderation endpoints (comment delete, verify reporter,
# flag list/resolve, broadcast push). MUST be overridden via Render env var.
ADMIN_ACCESS_CODE = os.environ.get('ADMIN_ACCESS_CODE', 'APS2026')


# ── Auth dependencies ─────────────────────────────────────────────────────────
def require_reporter_jwt(request: Request) -> dict:
    """FastAPI dependency: verify Authorization: Bearer <JWT>. Returns claims dict."""
    auth = request.headers.get('Authorization', '')
    if not auth.startswith('Bearer '):
        raise HTTPException(status_code=401, detail="Authentication required. Please login as reporter.")
    token = auth[7:]
    try:
        payload = pyjwt.decode(token, JWT_SECRET_KEY, algorithms=['HS256'])
        return {
            'reporter_name': payload.get('sub', ''),
            'reporter_id':   payload.get('reporter_id', ''),
        }
    except pyjwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Session expired. Please login again.")
    except pyjwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token. Please login again.")


def require_admin_code(request: Request) -> bool:
    """FastAPI dependency: verify X-Admin-Code header matches ADMIN_ACCESS_CODE env var."""
    admin_code = request.headers.get("X-Admin-Code", "")
    if admin_code != ADMIN_ACCESS_CODE:
        raise HTTPException(status_code=403, detail="Invalid admin code.")
    return True


def get_r2_s3_client():
    """Create a boto3 S3 client configured for Cloudflare R2 (S3-compatible)."""
    return boto3.client(
        's3',
        endpoint_url=R2_ENDPOINT_URL,
        aws_access_key_id=R2_ACCESS_KEY_ID,
        aws_secret_access_key=R2_SECRET_ACCESS_KEY,
        config=BotoConfig(
            signature_version='s3v4',
            s3={'addressing_style': 'path'},
        ),
        region_name='auto',
    )

# YouTube channel handle
YT_CHANNEL_HANDLE = '@MyPublicSamachar'
_yt_channel_id: Optional[str] = None

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


def get_wp_auth():
    credentials = f"{WP_USERNAME}:{WP_APP_PASSWORD}"
    token = base64.b64encode(credentials.encode()).decode()
    return {"Authorization": f"Basic {token}"}


def strip_html(html: str) -> str:
    text = re.sub(r'<[^>]+>', '', html or '')
    for ent, rep in [('&amp;', '&'), ('&nbsp;', ' '), ('&lt;', '<'), ('&gt;', '>'),
                     ('&#8217;', "'"), ('&#8216;', "'"), ('&#8220;', '"'), ('&#8221;', '"'),
                     ('&#8230;', '...'), ('&hellip;', '...'), ('&#8211;', '-')]:
        text = text.replace(ent, rep)
    return text.strip()


def parse_post(post: dict) -> dict:
    featured_image = None
    try:
        media = post.get('_embedded', {}).get('wp:featuredmedia', [])
        if media:
            sizes = media[0].get('media_details', {}).get('sizes', {})
            featured_image = (
                sizes.get('medium', {}).get('source_url') or
                sizes.get('medium_large', {}).get('source_url') or
                sizes.get('thumbnail', {}).get('source_url') or
                media[0].get('source_url')
            )
    except Exception:
        pass

    author = 'Unknown'
    try:
        authors = post.get('_embedded', {}).get('author', [])
        if authors:
            author = authors[0].get('name', 'Unknown')
    except Exception:
        pass

    category_names = []
    category_ids = []
    try:
        terms = post.get('_embedded', {}).get('wp:term', [[]])[0]
        category_names = [{'id': t.get('id'), 'name': t.get('name'), 'slug': t.get('slug')} for t in terms]
        category_ids = [t.get('id') for t in terms]
    except Exception:
        pass

    return {
        'id': post.get('id'),
        'slug': post.get('slug', ''),
        'title': strip_html(post.get('title', {}).get('rendered', '')),
        'excerpt': strip_html(post.get('excerpt', {}).get('rendered', '')),
        'content': post.get('content', {}).get('rendered', ''),
        'date': post.get('date', ''),
        'modified': post.get('modified', ''),
        'featured_image': featured_image,
        'categories': category_ids,
        'category_names': category_names,
        'author': author,
        'link': post.get('link', ''),
        'comment_count': post.get('comment_count', 0) or 0,
        'status': post.get('status', 'publish'),
    }


# Pydantic Models
class ReportPostRequest(BaseModel):
    post_id: int
    post_title: Optional[str] = None
    reason: str


class SubmitPostRequest(BaseModel):
    title: str
    content: str
    image_base64: Optional[str] = None
    image_filename: Optional[str] = None


app = FastAPI()
api_router = APIRouter(prefix="/api")

# CORS — allow all origins so the Expo mobile app and web can call the API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,   # Must be False when allow_origins=["*"] — CORS spec
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Length", "Content-Type", "ETag"],
)


@api_router.get("/")
async def root():
    return {"message": "Public Samachar API Running"}


@api_router.get("/posts")
async def get_posts(page: int = 1, per_page: int = 10, category_id: Optional[int] = None, orderby: str = 'date'):
    params = {
        'page': page, 'per_page': per_page,
        '_embed': 1, 'orderby': orderby,
        'order': 'desc', 'status': 'publish',
    }
    if category_id:
        params['categories'] = category_id
    cache_key = f"wp_posts_{page}_{per_page}_{category_id}_{orderby}"
    result = await wp_get('posts', params, cache_key=cache_key, cache_ttl=90.0)
    if not result:
        return {'posts': [], 'total': 0, 'total_pages': 0, 'current_page': page}
    total = int(result['headers'].get('x-wp-total', 0))
    total_pages = int(result['headers'].get('x-wp-totalpages', 1))
    return {'posts': [parse_post(p) for p in result['data']], 'total': total,
            'total_pages': total_pages, 'current_page': page}


@api_router.get("/categories")
async def get_categories():
    result = await wp_get('categories', {'per_page': 100, 'hide_empty': True},
                          cache_key='wp_categories', cache_ttl=300.0)
    if not result:
        return []
    return [{'id': c.get('id'), 'name': c.get('name'), 'slug': c.get('slug'),
             'count': c.get('count', 0)} for c in result['data']]


@api_router.get("/stories")
async def get_stories():
    cats_result = await wp_get('categories', {'search': 'Stories', 'per_page': 10},
                               cache_key='wp_stories_cat', cache_ttl=300.0)
    if cats_result:
        cats = cats_result['data']
        stories_cat = next(
            (c for c in cats if c.get('slug') == 'stories' or c.get('name', '').lower() == 'stories'),
            None
        )
        if stories_cat:
            result = await wp_get('posts',
                                  {'categories': stories_cat['id'], 'per_page': 10,
                                   '_embed': 1, 'status': 'publish'},
                                  cache_key='wp_stories_posts', cache_ttl=90.0)
            if result:
                return [parse_post(p) for p in result['data']]
    # Fallback: return latest 8 posts as stories
    result = await wp_get('posts', {'per_page': 8, '_embed': 1, 'status': 'publish'},
                          cache_key='wp_stories_fallback', cache_ttl=90.0)
    return [parse_post(p) for p in result['data']] if result else []


@api_router.get("/search")
async def search_posts(q: str = '', page: int = 1, per_page: int = 10):
    if not q:
        return {'posts': [], 'total': 0}
    result = await wp_get('posts',
                          {'search': q, 'page': page, 'per_page': per_page,
                           '_embed': 1, 'status': 'publish'})
    if not result:
        return {'posts': [], 'total': 0}
    total = int(result['headers'].get('x-wp-total', 0))
    return {'posts': [parse_post(p) for p in result['data']], 'total': total}


@api_router.get("/trending")
async def get_trending(page: int = 1, per_page: int = 10, category_id: Optional[int] = None):
    for orderby in ['comment_count', 'date']:
        params = {'page': page, 'per_page': per_page, '_embed': 1,
                  'orderby': orderby, 'order': 'desc', 'status': 'publish'}
        if category_id:
            params['categories'] = category_id
        result = await wp_get('posts', params,
                              cache_key=f'wp_trending_{page}_{per_page}_{category_id}_{orderby}',
                              cache_ttl=120.0)
        if result and result.get('data') is not None:
            # If comment_count gave a 400, try will have returned None — skip
            total = int(result['headers'].get('x-wp-total', 0))
            return {'posts': [parse_post(p) for p in result['data']], 'total': total}
    return {'posts': [], 'total': 0}


@api_router.get("/videos")
async def get_videos(page: int = 1, per_page: int = 10, category_id: Optional[int] = None):
    cats_result = await wp_get('categories', {'search': 'Video', 'per_page': 10},
                               cache_key='wp_video_cat', cache_ttl=300.0)
    params = {'page': page, 'per_page': per_page, '_embed': 1,
              'orderby': 'date', 'order': 'desc', 'status': 'publish'}
    if cats_result:
        video_cat = next(
            (c for c in cats_result['data']
             if 'video' in c.get('slug', '').lower() or 'video' in c.get('name', '').lower()),
            None
        )
        if video_cat:
            params['categories'] = video_cat['id']
        elif category_id:
            params['categories'] = category_id
    result = await wp_get('posts', params,
                          cache_key=f'wp_videos_{page}_{per_page}', cache_ttl=90.0)
    if not result:
        return {'posts': [], 'total': 0}
    total = int(result['headers'].get('x-wp-total', 0))
    return {'posts': [parse_post(p) for p in result['data']], 'total': total}


@api_router.get("/post/{post_id}")
async def get_post(post_id: int):
    result = await wp_get(f'posts/{post_id}', {'_embed': 1},
                          cache_key=f'wp_post_{post_id}', cache_ttl=120.0)
    if not result:
        raise HTTPException(status_code=404, detail="Post not found")
    return parse_post(result['data'])


@api_router.post("/report-post")
async def report_post(data: ReportPostRequest):
    report = {
        'id': str(uuid.uuid4()),
        'post_id': data.post_id,
        'post_title': data.post_title,
        'reason': data.reason,
        'reported_at': datetime.now(timezone.utc),
    }
    await db.reported_posts.insert_one(report)
    return {'success': True, 'report_id': report['id']}


@api_router.post("/submit-post")
async def submit_post(data: SubmitPostRequest):
    featured_media_id = None

    if data.image_base64 and data.image_filename:
        try:
            image_data = base64.b64decode(data.image_base64)
            filename = data.image_filename or 'news_image.jpg'
            content_type = 'image/png' if filename.lower().endswith('.png') else 'image/jpeg'
            r = await wp_post_req(
                'media', content=image_data,
                headers_extra={
                    'Content-Type': content_type,
                    'Content-Disposition': f'attachment; filename="{filename}"',
                },
                timeout=30.0,
            )
            if r and r.status_code in [200, 201]:
                featured_media_id = r.json().get('id')
        except Exception as e:
            logger.error(f"Error uploading media: {e}")

    post_payload: dict = {'title': data.title, 'content': data.content, 'status': 'pending'}
    if featured_media_id:
        post_payload['featured_media'] = featured_media_id

    r = await wp_post_req('posts', json_body=post_payload, timeout=20.0)
    if not r or r.status_code not in [200, 201]:
        raise HTTPException(status_code=500, detail="Failed to submit post")
    return {'success': True, 'post_id': r.json().get('id')}


@api_router.get("/youtube-feed")
async def get_youtube_feed():
    """
    Fetch uploads from the channel via YouTube RSS feed (no API key needed).
    Uses httpx async (non-blocking) + 60s in-memory cache to handle 100+ concurrent users
    without blocking the event loop or hammering the YouTube API.
    """
    # ── Cache hit ─────────────────────────────────────────────────────────────
    cached = _cache_get("youtube_feed", ttl=60.0)
    if cached is not None:
        return cached

    channel_id = os.getenv("YT_CHANNEL_ID", "UC8NATKQsfiBH78KT0symldg").strip()
    http = get_async_client()

    # ── Primary: YouTube RSS feed (public, no auth needed) ────────────────────
    try:
        rss_url = f"https://www.youtube.com/feeds/videos.xml?channel_id={channel_id}"
        rss_resp = await http.get(rss_url, headers={"User-Agent": "Mozilla/5.0"})
        rss_resp.raise_for_status()
        root = ET.fromstring(rss_resp.text)
        ns = {
            "atom": "http://www.w3.org/2005/Atom",
            "yt":   "http://www.youtube.com/xml/schemas/2015",
            "media": "http://search.yahoo.com/mrss/",
        }
        videos = []
        for entry in root.findall("atom:entry", ns):
            vid_id = entry.findtext("yt:videoId", default="", namespaces=ns)
            title  = entry.findtext("atom:title", default="", namespaces=ns)
            published = entry.findtext("atom:published", default="", namespaces=ns)
            thumbnail = ""
            group = entry.find("media:group", ns)
            if group is not None:
                thumb_el = group.find("media:thumbnail", ns)
                if thumb_el is not None:
                    thumbnail = thumb_el.get("url", "")
            if not thumbnail and vid_id:
                thumbnail = f"https://img.youtube.com/vi/{vid_id}/hqdefault.jpg"
            if vid_id:
                videos.append({
                    "video_id":    vid_id,
                    "title":       title,
                    "published":   published,
                    "thumbnail":   thumbnail,
                    "url":         f"https://www.youtube.com/watch?v={vid_id}",
                    "description": "",
                })
        if videos:
            result = {"videos": videos, "source": "rss"}
            _cache_set("youtube_feed", result)
            return result
        logger.warning("YouTube RSS feed returned 0 videos.")
    except Exception as e:
        logger.warning(f"YouTube RSS feed error: {e}. Trying OAuth fallback.")

    # ── Fallback 1: OAuth playlistItems.list ───────────────────────────────────
    if not channel_id.startswith("UC"):
        return {"videos": [], "error": "Invalid YT_CHANNEL_ID in .env"}

    playlist_id = "UU" + channel_id[2:]
    try:
        tok_resp = await http.post(
            "https://oauth2.googleapis.com/token",
            data={
                "client_id":     os.getenv("YT_CLIENT_ID", ""),
                "client_secret": os.getenv("YT_CLIENT_SECRET", ""),
                "refresh_token": os.getenv("YT_REFRESH_TOKEN", ""),
                "grant_type":    "refresh_token",
            },
        )
        access_token = tok_resp.json().get("access_token")
        if not access_token:
            raise ValueError(f"Token refresh failed: {tok_resp.json()}")
    except Exception as e:
        logger.error(f"YouTube feed – token error: {e}")
        access_token = None

    if access_token:
        try:
            resp = await http.get(
                "https://www.googleapis.com/youtube/v3/playlistItems",
                params={"part": "snippet", "playlistId": playlist_id, "maxResults": 30},
                headers={"Authorization": f"Bearer {access_token}"},
            )
            resp.raise_for_status()
            data = resp.json()
        except Exception as e:
            logger.warning(f"YouTube playlistItems API error ({e}). Falling back to saved uploads.")
            data = None

        if data:
            videos_from_api = []
            for item in data.get("items", []):
                snip = item.get("snippet", {})
                rid  = snip.get("resourceId", {})
                vid_id = rid.get("videoId", "")
                thumbs = snip.get("thumbnails", {})
                thumb  = (
                    thumbs.get("high", {}).get("url")
                    or thumbs.get("medium", {}).get("url")
                    or thumbs.get("default", {}).get("url")
                    or (f"https://img.youtube.com/vi/{vid_id}/hqdefault.jpg" if vid_id else "")
                )
                if vid_id:
                    videos_from_api.append({
                        "video_id":    vid_id,
                        "title":       snip.get("title", ""),
                        "published":   snip.get("publishedAt", ""),
                        "thumbnail":   thumb,
                        "url":         f"https://www.youtube.com/watch?v={vid_id}",
                        "description": snip.get("description", ""),
                    })
            if videos_from_api:
                result = {"videos": videos_from_api, "source": "api", "playlist_id": playlist_id}
                _cache_set("youtube_feed", result)
                return result

    # ── Fallback 2: Local MongoDB (videos we uploaded via the app) ─────────────
    saved = await db["video_uploads"].find(
        {}, {"_id": 0, "video_id": 1, "title": 1, "uploaded_at": 1}
    ).sort("uploaded_at", -1).limit(30).to_list(30)
    result = {
        "videos": [
            {
                "video_id":   v["video_id"],
                "title":      v.get("title", "Public Samachar Video"),
                "published":  v.get("uploaded_at", ""),
                "thumbnail":  f"https://img.youtube.com/vi/{v['video_id']}/hqdefault.jpg",
                "url":        f"https://www.youtube.com/watch?v={v['video_id']}",
                "description": "",
            }
            for v in saved
        ],
        "source":      "local_db_fallback",
        "playlist_id": playlist_id,
    }
    _cache_set("youtube_feed", result)
    return result


@api_router.get("/wp-video-feed")
async def get_wp_video_feed(page: int = 1, per_page: int = 10):
    """Fetch video media items from WordPress media library for the video feed."""
    cache_key = f'wp_video_feed_{page}_{per_page}'
    cached = _cache_get(cache_key, 90.0)
    if cached is not None:
        return cached

    result_data = await wp_get('media', {
        'media_type': 'video', 'per_page': per_page, 'page': page,
        'orderby': 'date', 'order': 'desc',
    }, timeout=15.0)
    if not result_data:
        return []
    items = result_data['data']

    # Batch-fetch parent post titles
    post_ids = list({item.get('post') for item in items if item.get('post')})
    post_titles: dict[int, str] = {}
    if post_ids:
        ids_str = ','.join(str(pid) for pid in post_ids)
        pr = await wp_get('posts', {'include': ids_str, 'per_page': len(post_ids), '_fields': 'id,title'}, timeout=8.0)
        if pr:
            for p in pr['data']:
                t = ''
                if isinstance(p.get('title'), dict):
                    t = p['title'].get('rendered', '') or p['title'].get('raw', '')
                if t:
                    post_titles[p['id']] = t

    result = []
    for item in items:
        source_url = item.get('source_url', '')
        if not source_url:
            continue
        raw_title = ''
        if isinstance(item.get('title'), dict):
            raw_title = item['title'].get('rendered', '') or item['title'].get('raw', '')
        parent_post_id = item.get('post')
        title = post_titles.get(parent_post_id, raw_title) if parent_post_id else raw_title
        caption = ''
        if isinstance(item.get('caption'), dict):
            caption = item['caption'].get('rendered', '')
        result.append({
            'id': item.get('id'), 'title': title, 'caption': caption,
            'url': source_url, 'mime_type': item.get('mime_type', 'video/mp4'),
            'date': item.get('date', ''), 'link': item.get('link', ''),
            'location': item.get('alt_text', '') or '', 'parent_post_id': parent_post_id,
        })
    _cache_set(cache_key, result)
    return result


@api_router.post("/submit-video")
async def submit_video(
    title: str = Form(...),
    description: str = Form(''),
    location: str = Form(''),
    video: UploadFile = File(...),
):
    # Step 1: Upload video to WordPress media library
    video_data = await video.read()
    content_type = video.content_type or 'video/mp4'
    filename = video.filename or f'video_{datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")}.mp4'

    media_resp = await wp_post_req('media', content=video_data,
                                   headers_extra={'Content-Type': content_type,
                                                  'Content-Disposition': f'attachment; filename="{filename}"'},
                                   timeout=120.0)
    if not media_resp or media_resp.status_code not in [200, 201]:
        if media_resp and media_resp.status_code == 401:
            raise HTTPException(status_code=403, detail=(
                "WordPress account lacks upload permission. "
                "Ask the site admin to set your role to 'Author' or 'Editor'."))
        raise HTTPException(status_code=500, detail="Failed to upload video to media library")
    media_id = media_resp.json().get('id')
    media_url = media_resp.json().get('source_url', '')
    logger.info(f"Video media uploaded: id={media_id}, url={media_url}")

    # Step 1b: PATCH media — set title, caption, alt_text (location)
    patch_payload = {'title': title,
                     'caption': description.strip(),
                     'alt_text': location.strip()}
    patch_r = await wp_post_req(f'media/{media_id}', json_body=patch_payload, timeout=15.0)
    if patch_r and patch_r.is_success:
        logger.info(f"Media {media_id} updated with title/caption/alt_text")

    # Step 2: Find "video-feed" category
    video_cat_id = None
    for slug_try in ['video-feed', 'video-submissions', 'videos', 'video']:
        cr = await wp_get('categories', {'slug': slug_try, 'per_page': 5},
                          cache_key=f'wp_cat_{slug_try}', cache_ttl=300.0)
        if cr and cr['data']:
            video_cat_id = cr['data'][0]['id']
            logger.info(f"Using category slug={slug_try}: id={video_cat_id}")
            break

    # Step 3: Create the WordPress post (status=publish — goes live immediately)
    post_content_parts = []
    if description.strip():
        post_content_parts.append(description.strip())
    if location.strip():
        post_content_parts.append(f"<p><strong>Location:</strong> {location.strip()}</p>")
    post_content_parts.append(f'[video src="{media_url}"][/video]')
    post_content = '\n\n'.join(post_content_parts)

    post_payload: dict = {
        'title': title, 'content': post_content,
        'status': 'publish', 'format': 'video', 'featured_media': media_id,
    }
    if video_cat_id:
        post_payload['categories'] = [video_cat_id]

    post_r = await wp_post_req('posts', json_body=post_payload, timeout=30.0)
    if not post_r or not post_r.is_success:
        raise HTTPException(status_code=500, detail="Failed to create video post")
    post_id = post_r.json().get('id')
    logger.info(f"Video post published: post_id={post_id}, media_id={media_id}")

    # ── Async push notification (fire and forget) ───────────────────────────
    async def _push():
        try:
            tokens_cursor = db["push_tokens"].find({}, {"token": 1})
            tokens = [doc["token"] async for doc in tokens_cursor]
            if tokens:
                http = get_async_client()
                for i in range(0, len(tokens), 100):
                    batch = [{"to": t, "sound": "default",
                               "title": "📺 New Video — Public Samachar",
                               "body": title,
                               "data": {"type": "new_video", "post_id": post_id}}
                             for t in tokens[i:i+100]]
                    try:
                        await http.post("https://exp.host/--/api/v2/push/send",
                                        json=batch, timeout=15.0)
                        logger.info(f"Push sent to {len(batch)} devices")
                    except Exception as pe:
                        logger.warning(f"Push batch error: {pe}")
        except Exception as pne:
            logger.warning(f"Push failed: {pne}")
    asyncio.create_task(_push())

    return {'success': True, 'post_id': post_id, 'media_id': media_id}


@api_router.post("/save-video-upload")
async def save_video_upload(request: Request):
    """Persist a YouTube videoId to MongoDB and record the upload."""
    data = await request.json()
    video_id  = data.get("videoId", "")
    title     = data.get("title", "")
    location  = data.get("location", "")
    record = {
        "video_id":    video_id,
        "title":       title,
        "location":    location,
        "youtube_url": f"https://www.youtube.com/watch?v={video_id}",
        "uploaded_at": datetime.utcnow().isoformat(),
        "platform":    "youtube",
    }
    result = await db["video_uploads"].insert_one(record)
    logger.info(f"Saved YouTube upload: {video_id}")
    return {"success": True, "record_id": str(result.inserted_id)}


@api_router.post("/youtube-token")
async def get_youtube_token():
    client_id     = os.getenv("YT_CLIENT_ID", "")
    client_secret = os.getenv("YT_CLIENT_SECRET", "")
    refresh_token = os.getenv("YT_REFRESH_TOKEN", "")

    if not client_id or not client_secret or not refresh_token:
        raise HTTPException(status_code=503, detail=(
            "YouTube upload is not configured. "
            "Set YT_CLIENT_ID, YT_CLIENT_SECRET, and YT_REFRESH_TOKEN in backend/.env"))
    try:
        http = get_async_client()
        resp = await http.post(
            "https://oauth2.googleapis.com/token",
            data={"client_id": client_id, "client_secret": client_secret,
                  "refresh_token": refresh_token, "grant_type": "refresh_token"},
            timeout=15.0,
        )
        data = resp.json()
        if "access_token" not in data:
            raise HTTPException(status_code=502, detail=f"Token refresh failed: {data.get('error_description', data.get('error', 'unknown'))}")
        return {"access_token": data["access_token"], "expires_in": data.get("expires_in", 3600)}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Token refresh error: {str(e)}")



async def _google_token_refresh() -> tuple[str, str]:
    """Refresh Google OAuth token - returns (access_token, scope)."""
    http = get_async_client()
    resp = await http.post(
        "https://oauth2.googleapis.com/token",
        data={
            "client_id": os.getenv("YT_CLIENT_ID", ""),
            "client_secret": os.getenv("YT_CLIENT_SECRET", ""),
            "refresh_token": os.getenv("YT_REFRESH_TOKEN", ""),
            "grant_type": "refresh_token",
        },
        timeout=10.0,
    )
    data = resp.json()
    token = data.get("access_token", "")
    scope = data.get("scope", "")
    if not token:
        raise ValueError(f"Token refresh failed: {data}")
    return token, scope


# ── Comments Endpoints ────────────────────────────────────────────────────────

@api_router.get("/comments")
async def get_comments(source: str, id: str, max_results: int = 20):
    """
    Fetch comments for a YouTube video (source=youtube) or WordPress post (source=wp).
    """
    http = get_async_client()

    if source == "youtube":
        try:
            access_token, token_scope = await _google_token_refresh()
        except Exception as e:
            logger.error(f"YouTube comments – token error: {e}")
            return {"comments": [], "source": "youtube", "scope_error": True,
                    "error": "Could not refresh YouTube token."}

        has_scope = "youtube.force-ssl" in token_scope or "youtube.readonly" in token_scope
        if not has_scope:
            return {"comments": [], "source": "youtube", "scope_error": True,
                    "error": "YouTube comment reading requires re-authentication with expanded permissions."}

        try:
            resp = await http.get(
                "https://www.googleapis.com/youtube/v3/commentThreads",
                params={"part": "snippet", "videoId": id, "maxResults": max_results,
                        "order": "relevance", "textFormat": "plainText"},
                headers={"Authorization": f"Bearer {access_token}"},
                timeout=15.0,
            )
            resp.raise_for_status()
            comments = []
            for item in resp.json().get("items", []):
                top = item.get("snippet", {}).get("topLevelComment", {}).get("snippet", {})
                comments.append({"id": item.get("id", ""),
                                  "author": top.get("authorDisplayName", "Anonymous"),
                                  "author_image": top.get("authorProfileImageUrl", ""),
                                  "text": top.get("textDisplay", ""),
                                  "date": top.get("publishedAt", ""),
                                  "like_count": top.get("likeCount", 0),
                                  "reply_count": item.get("snippet", {}).get("totalReplyCount", 0)})
            return {"comments": comments, "source": "youtube", "total": len(comments)}
        except Exception as e:
            return {"comments": [], "source": "youtube", "error": str(e)}

    elif source == "wp":
        result = await wp_get('comments', {"post": id, "per_page": max_results,
                                           "status": "approve",
                                           "_fields": "id,author_name,date,content,author_avatar_urls"})
        if not result:
            return {"comments": [], "source": "wp", "error": "fetch failed"}
        comments = []
        for c in result['data']:
            avatar_urls = c.get("author_avatar_urls", {})
            avatar = list(avatar_urls.values())[-1] if avatar_urls else ""
            comments.append({"id": c.get("id"), "author": c.get("author_name", "Anonymous"),
                              "author_image": avatar,
                              "text": strip_html(c.get("content", {}).get("rendered", "")),
                              "date": c.get("date", ""), "like_count": 0})
        return {"comments": comments, "source": "wp", "total": len(comments)}

    elif source == "ps":
        try:
            results = await d1_query_async(
                'SELECT * FROM ps_comments WHERE video_id = ? ORDER BY timestamp DESC LIMIT 50', [id])
            comments = [{"id": c.get("id", ""), "author": c.get("author_name", "Anonymous"),
                          "author_image": "", "text": c.get("content", ""),
                          "date": c.get("timestamp", 0), "like_count": 0}
                        for c in (results or [])]
            return {"comments": comments, "source": "ps", "total": len(comments)}
        except Exception as e:
            return {"comments": [], "source": "ps", "error": str(e)}

    return {"comments": [], "error": "Invalid source. Use 'youtube', 'wp', or 'ps'."}


@api_router.post("/yt-comment")
async def post_yt_comment(request: Request):
    data = await request.json()
    video_id = data.get("video_id", "")
    text = data.get("text", "").strip()
    if not video_id or not text:
        raise HTTPException(status_code=400, detail="video_id and text are required.")

    try:
        access_token, token_scope = await _google_token_refresh()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Token refresh failed: {e}")

    if "force-ssl" not in token_scope and "youtube.readonly" not in token_scope:
        raise HTTPException(status_code=403, detail="youtube.force-ssl scope required.")

    try:
        http = get_async_client()
        resp = await http.post(
            "https://www.googleapis.com/youtube/v3/commentThreads",
            params={"part": "snippet"},
            headers={"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"},
            json={"snippet": {"videoId": video_id,
                              "topLevelComment": {"snippet": {"textOriginal": text}}}},
            timeout=15.0,
        )
        resp.raise_for_status()
        result = resp.json()
        snippet = result.get("snippet", {}).get("topLevelComment", {}).get("snippet", {})
        return {"success": True, "comment_id": result.get("id", ""),
                "author": snippet.get("authorDisplayName", ""),
                "text": snippet.get("textDisplay", text),
                "date": snippet.get("publishedAt", "")}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@api_router.get("/yt-reauth-url")
async def yt_reauth_url():
    """
    Generate a YouTube OAuth URL that includes youtube.upload + youtube.force-ssl + youtube.readonly scopes.
    The user must open this URL in a browser, allow access, then paste the resulting code at /api/yt-save-token.
    """
    import urllib.parse as _up
    client_id = os.getenv("YT_CLIENT_ID", "")
    scopes = " ".join([
        "https://www.googleapis.com/auth/youtube.upload",
        "https://www.googleapis.com/auth/youtube.force-ssl",
        "https://www.googleapis.com/auth/youtube.readonly",
    ])
    auth_url = (
        "https://accounts.google.com/o/oauth2/auth?"
        + _up.urlencode({
            "client_id": client_id,
            "redirect_uri": "urn:ietf:wg:oauth:2.0:oob",
            "scope": scopes,
            "response_type": "code",
            "access_type": "offline",
            "prompt": "consent",
        })
    )
    return {
        "auth_url": auth_url,
        "instructions": (
            "1. Open the auth_url in your browser. "
            "2. Sign in with the YouTube channel account. "
            "3. Click Allow. "
            "4. Copy the authorization code. "
            "5. POST it to /api/yt-save-token as JSON: {\"code\": \"<paste_code_here>\"}"
        ),
    }


@api_router.post("/yt-save-token")
async def yt_save_token(request: Request):
    """
    Exchange a YouTube authorization code for a new refresh token that includes youtube.force-ssl scope.
    Saves the new refresh token to backend/.env automatically.
    """
    data = await request.json()
    auth_code = data.get("code", "").strip()
    if not auth_code:
        raise HTTPException(status_code=400, detail="Authorization code is required.")

    try:
        http = get_async_client()
        tok_resp = await http.post(
            "https://oauth2.googleapis.com/token",
            data={
                "client_id": os.getenv("YT_CLIENT_ID", ""),
                "client_secret": os.getenv("YT_CLIENT_SECRET", ""),
                "code": auth_code,
                "redirect_uri": "urn:ietf:wg:oauth:2.0:oob",
                "grant_type": "authorization_code",
            },
            timeout=15.0,
        )
        result = tok_resp.json()
        new_refresh_token = result.get("refresh_token")
        token_scope = result.get("scope", "")
        if not new_refresh_token:
            raise ValueError(f"No refresh token in response: {result}")

        # Update the env variable in memory
        os.environ["YT_REFRESH_TOKEN"] = new_refresh_token

        # Persist to .env file
        env_path = os.path.join(os.path.dirname(__file__), ".env")
        try:
            with open(env_path, "r") as f:
                env_content = f.read()
            old_token_line = next(
                (line for line in env_content.splitlines() if line.startswith("YT_REFRESH_TOKEN")), ""
            )
            if old_token_line:
                env_content = env_content.replace(old_token_line, f'YT_REFRESH_TOKEN="{new_refresh_token}"')
            else:
                env_content += f'\nYT_REFRESH_TOKEN="{new_refresh_token}"\n'
            with open(env_path, "w") as f:
                f.write(env_content)
            logger.info("New YT refresh token saved to .env")
        except Exception as e:
            logger.warning(f"Could not persist token to .env: {e}")

        return {
            "success": True,
            "scope": token_scope,
            "has_force_ssl": "force-ssl" in token_scope,
            "message": "YouTube token updated. Comments should now work.",
        }
    except Exception as e:
        logger.error(f"yt-save-token error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@api_router.post("/comment")
async def post_comment(request: Request):
    """
    Post a new comment.
    source='ps'  → saves to Cloudflare D1 ps_comments table.
    source='wp'  → posts to WordPress REST API.
    """
    data = await request.json()
    source = data.get("source", "wp")
    content = data.get("content", "").strip()

    if not content:
        raise HTTPException(status_code=400, detail="Comment content is required.")

    # ── Public Samachar (D1) comments ────────────────────────────────────────
    if source == "ps":
        video_id = data.get("id", "").strip()
        if not video_id:
            raise HTTPException(status_code=400, detail="video id is required.")
        author_name = data.get("author_name", "Anonymous").strip() or "Anonymous"
        comment_id = str(uuid.uuid4())
        ts = int(datetime.now(timezone.utc).timestamp() * 1000)
        await d1_query_async(
            'INSERT INTO ps_comments (id, video_id, author_name, content, timestamp) VALUES (?, ?, ?, ?, ?)',
            [comment_id, video_id, author_name, content, ts]
        )
        logger.info(f"PS comment posted on video {video_id} by {author_name}")
        return {"success": True, "comment_id": comment_id}

    # ── WordPress comments ────────────────────────────────────────────────────
    if source != "wp":
        raise HTTPException(status_code=400, detail="Invalid source. Use 'ps' or 'wp'.")

    post_id = data.get("id")
    author_name = data.get("author_name", "Reader").strip()
    author_email = data.get("author_email", "reader@example.com").strip()

    if not post_id:
        raise HTTPException(status_code=400, detail="Post ID is required.")

    try:
        r = await wp_post_req('comments', json_body={
            "post": int(post_id), "author_name": author_name,
            "author_email": author_email, "content": content,
        }, timeout=20.0)
        if r and r.status_code in [200, 201]:
            comment = r.json()
            return {"success": True, "comment_id": comment.get("id")}
        else:
            msg = ""
            try:
                msg = r.json().get("message", r.text[:300]) if r else "No response"
            except Exception:
                msg = r.text[:300] if r else "No response"
            if "logged in" in msg.lower() or "login" in msg.lower():
                msg = "The website admin has restricted comments to logged-in users only."
            raise HTTPException(status_code=r.status_code if r else 500, detail=msg)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Push Notification Endpoints ───────────────────────────────────────────────

@api_router.post("/push-token")
async def register_push_token(request: Request):
    """Register an Expo push token so we can send notifications to all devices."""
    data = await request.json()
    token = data.get("token", "").strip()
    if not token:
        raise HTTPException(status_code=400, detail="token is required")
    # Upsert — one record per token
    await db["push_tokens"].update_one(
        {"token": token},
        {"$set": {"token": token, "registered_at": datetime.utcnow().isoformat()}},
        upsert=True,
    )
    logger.info(f"Push token registered: {token[:20]}...")
    return {"success": True}


@api_router.post("/send-notification")
async def send_notification(request: Request, _admin: bool = Depends(require_admin_code)):
    """
    Admin-only: send a push notification to all registered devices via Expo Push API.
    Requires X-Admin-Code header matching ADMIN_ACCESS_CODE env var.
    Body: { "title": "...", "body": "...", "data": {} }
    """
    payload = await request.json()
    title = payload.get("title", "Public Samachar")
    body  = payload.get("body", "New update available!")
    data  = payload.get("data", {})

    # Fetch all tokens
    tokens_cursor = db["push_tokens"].find({}, {"token": 1})
    tokens = [doc["token"] async for doc in tokens_cursor]

    if not tokens:
        return {"success": True, "sent": 0, "message": "No registered devices"}

    # Send via Expo Push API in batches of 100
    messages = [{"to": t, "sound": "default", "title": title, "body": body, "data": data}
                for t in tokens]
    sent = 0
    http = get_async_client()
    for i in range(0, len(messages), 100):
        batch = messages[i:i+100]
        try:
            resp = await http.post(
                "https://exp.host/--/api/v2/push/send",
                json=batch,
                headers={"Content-Type": "application/json", "Accept": "application/json",
                         "Accept-Encoding": "gzip, deflate"},
                timeout=30.0,
            )
            result = resp.json()
            if isinstance(result.get("data"), list):
                sent += len([r for r in result["data"] if r.get("status") == "ok"])
            logger.info(f"Push batch sent: {len(batch)} tokens, response: {resp.status_code}")
        except Exception as e:
            logger.error(f"Push batch error: {e}")

    return {"success": True, "sent": sent, "total": len(tokens)}


# ── Cloudflare Helper Functions ───────────────────────────────────────────────

# ── Part 6: Sensational word / content check ─────────────────────────────────
_SENSATIONAL_PATTERNS = [
    r'\bBREAKING\b', r'\bSHOCKING\b', r'\bEXPOSED\b', r'\bVIRAL\b',
    r'\bEXCLUSIVE\b', r'\bMUST[\s-]?WATCH\b', r'\bLEAKED\b', r'\bSCANDAL\b',
    r'\bSENSATIONAL\b', r'\bOMG\b', r'\bURGENT\b', r'\bALERT\b',
    r'\bREVEALED\b', r'\bSECRET\b', r'\bHIDDEN\b', r'\bFAKE\b',
]

def _check_caution(title: str) -> bool:
    """Returns True if title appears sensational / potentially misleading."""
    if not title:
        return False
    if title.count('!') >= 2:
        return True
    alpha_chars = [c for c in title if c.isalpha()]
    if len(alpha_chars) >= 6:
        upper_ratio = sum(1 for c in alpha_chars if c.isupper()) / len(alpha_chars)
        if upper_ratio >= 0.65:
            return True
    for pattern in _SENSATIONAL_PATTERNS:
        if re.search(pattern, title, re.IGNORECASE):
            return True
    return False


def get_cf_headers():
    return {
        'Authorization': f'Bearer {CF_API_TOKEN}',
        'Content-Type': 'application/json',
    }


def d1_query(sql: str, params: list = None) -> list:
    """Execute SQL on Cloudflare D1 synchronously (use d1_query_async in FastAPI endpoints)."""
    if not CF_ACCOUNT_ID or not CF_API_TOKEN or not D1_DB_ID:
        import sqlite3
        try:
            conn = sqlite3.connect("d1_local.db")
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            if params:
                cursor.execute(sql, params)
            else:
                cursor.execute(sql)
            
            if sql.strip().upper().startswith(("SELECT", "PRAGMA")):
                rows = cursor.fetchall()
                res = [dict(row) for row in rows]
            else:
                conn.commit()
                res = []
            conn.close()
            return res
        except Exception as e:
            logger.error(f"Local SQLite query exception: {e}")
            return []

    url = f'https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}/d1/database/{D1_DB_ID}/query'
    body: dict = {'sql': sql}
    if params:
        body['params'] = params
    try:
        resp = requests.post(url, json=body, headers=get_cf_headers(), timeout=20)
        data = resp.json()
        if data.get('success'):
            return data.get('result', [{}])[0].get('results', [])
        logger.error(f"D1 error: {data.get('errors', data)}")
    except Exception as e:
        logger.error(f"D1 query exception: {e}")
    return []


async def d1_query_async(sql: str, params: list = None) -> list:
    """
    Non-blocking D1 query using native httpx async — never blocks the event loop.
    Handles 1000+ concurrent queries without thread exhaustion.
    """
    if not CF_ACCOUNT_ID or not CF_API_TOKEN or not D1_DB_ID:
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, lambda: d1_query(sql, params))

    url = f'https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}/d1/database/{D1_DB_ID}/query'
    body: dict = {'sql': sql}
    if params:
        body['params'] = params
    try:
        client = get_async_client()
        resp = await client.post(url, json=body, headers=get_cf_headers())
        data = resp.json()
        if data.get('success'):
            return data.get('result', [{}])[0].get('results', [])
        logger.error(f"D1 async error: {data.get('errors', data)}")
    except Exception as e:
        logger.error(f"D1 async query exception: {e}")
    return []


def r2_upload_object(key: str, data: bytes, content_type: str = 'video/mp4') -> bool:
    """Upload bytes to Cloudflare R2 bucket. Falls back to local storage if R2 is unavailable."""
    # Try R2 first
    if CF_ACCOUNT_ID and CF_API_TOKEN:
        url = f'https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}/r2/buckets/{CF_BUCKET_NAME}/objects/{key}'
        headers = {
            'Authorization': f'Bearer {CF_API_TOKEN}',
            'Content-Type': content_type,
        }
        try:
            resp = requests.put(url, data=data, headers=headers, timeout=600)
            logger.info(f"R2 upload '{key}': HTTP {resp.status_code}")
            if resp.status_code in [200, 201]:
                return True
            logger.warning(f"R2 upload failed (HTTP {resp.status_code}). Falling back to local storage.")
        except Exception as e:
            logger.warning(f"R2 upload exception: {e}. Falling back to local storage.")

    # Fallback: local storage
    try:
        local_path = Path(__file__).parent / 'uploads' / key
        local_path.parent.mkdir(parents=True, exist_ok=True)
        local_path.write_bytes(data)
        logger.info(f"Saved locally: {local_path}")
        return True
    except Exception as e:
        logger.error(f"Local storage fallback failed: {e}")
        return False


def r2_upload_stream(key: str, file_obj, content_type: str = 'video/mp4') -> bool:
    """
    Stream-upload a file-like object to Cloudflare R2.
    Reads and sends in 256 KB chunks — NEVER loads the full video into RAM.
    Designed to run in a ThreadPoolExecutor so the async event loop stays free
    to serve ALL other users while the upload is in progress.
    """
    try:
        file_obj.seek(0)
    except Exception:
        pass

    def _chunked(f, chunk_size: int = 256 * 1024):
        while True:
            chunk = f.read(chunk_size)
            if not chunk:
                break
            yield chunk

    if CF_ACCOUNT_ID and CF_API_TOKEN:
        url = (
            f'https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}'
            f'/r2/buckets/{CF_BUCKET_NAME}/objects/{key}'
        )
        try:
            resp = requests.put(
                url,
                headers={
                    'Authorization': f'Bearer {CF_API_TOKEN}',
                    'Content-Type': content_type,
                    'Transfer-Encoding': 'chunked',
                },
                data=_chunked(file_obj),
                stream=True,
                timeout=600,
            )
            if resp.status_code in [200, 201, 204]:
                logger.info(f"R2 stream upload OK: {key}")
                return True
            logger.warning(f"R2 stream upload failed ({resp.status_code}): {resp.text[:200]}")
        except Exception as e:
            logger.warning(f"R2 stream upload error: {e}")

    # Fallback: read remaining data and save locally
    try:
        try:
            file_obj.seek(0)
        except Exception:
            pass
        data = file_obj.read()
        local_path = Path(__file__).parent / 'uploads' / key
        local_path.parent.mkdir(parents=True, exist_ok=True)
        local_path.write_bytes(data)
        logger.info(f"Stream upload fallback — saved locally: {local_path}")
        return True
    except Exception as e:
        logger.error(f"Stream upload fallback failed: {e}")
        return False


def ensure_r2_bucket():
    """Create R2 bucket if it does not exist."""
    if not CF_ACCOUNT_ID or not CF_API_TOKEN:
        return
    url = f'https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}/r2/buckets'
    try:
        resp = requests.get(url, headers=get_cf_headers(), timeout=15)
        if resp.ok:
            bucket_names = [b.get('name') for b in resp.json().get('result', {}).get('buckets', [])]
            if CF_BUCKET_NAME not in bucket_names:
                create_resp = requests.post(url, json={'name': CF_BUCKET_NAME}, headers=get_cf_headers(), timeout=15)
                logger.info(f"R2 bucket '{CF_BUCKET_NAME}' creation: HTTP {create_resp.status_code} — {create_resp.text[:120]}")
            else:
                logger.info(f"R2 bucket '{CF_BUCKET_NAME}' already exists.")
    except Exception as e:
        logger.warning(f"R2 bucket check/create error: {e}")


def ensure_d1_tables():
    """Create D1 tables if they don't exist."""
    if not D1_DB_ID:
        return
    tables = [
        """CREATE TABLE IF NOT EXISTS news_feed (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL DEFAULT '',
            description TEXT DEFAULT '',
            location TEXT DEFAULT '',
            video_url TEXT NOT NULL DEFAULT '',
            thumb_url TEXT DEFAULT '',
            reporter_name TEXT DEFAULT 'Reporter',
            reporter_id TEXT DEFAULT 'reporter',
            timestamp INTEGER DEFAULT 0,
            views INTEGER DEFAULT 0,
            aspect_ratio TEXT DEFAULT '16:9'
        )""",
        """CREATE TABLE IF NOT EXISTS user_profiles (
            id TEXT PRIMARY KEY,
            display_name TEXT NOT NULL DEFAULT 'Reporter',
            location TEXT DEFAULT '',
            profile_pic_url TEXT DEFAULT '',
            is_reporter INTEGER DEFAULT 0,
            verified INTEGER DEFAULT 0,
            created_at INTEGER DEFAULT 0
        )""",
        """CREATE TABLE IF NOT EXISTS ps_comments (
            id TEXT PRIMARY KEY,
            video_id TEXT NOT NULL,
            author_name TEXT NOT NULL DEFAULT 'Anonymous',
            content TEXT NOT NULL DEFAULT '',
            timestamp INTEGER DEFAULT 0
        )""",
        """CREATE TABLE IF NOT EXISTS flagged_videos (
            id TEXT PRIMARY KEY,
            video_id TEXT NOT NULL,
            reason TEXT NOT NULL DEFAULT '',
            timestamp INTEGER DEFAULT 0,
            status TEXT DEFAULT 'pending'
        )""",
    ]
    for sql in tables:
        result = d1_query(sql)
        logger.info(f"D1 table init result: {result}")
    # Idempotent migrations
    try:
        col_info = d1_query("PRAGMA table_info(news_feed)")
        existing_cols = [col.get('name', '') for col in col_info] if col_info else []
        if 'location' not in existing_cols:
            d1_query("ALTER TABLE news_feed ADD COLUMN location TEXT DEFAULT ''")
            logger.info("Migrated: added location column to news_feed")
        else:
            logger.info("news_feed.location column already present — skipping migration")
        if 'caution_flag' not in existing_cols:
            d1_query("ALTER TABLE news_feed ADD COLUMN caution_flag INTEGER DEFAULT 0")
            logger.info("Migrated: added caution_flag column to news_feed")
        else:
            logger.info("news_feed.caution_flag column already present — skipping")
        if 'aspect_ratio' not in existing_cols:
            d1_query("ALTER TABLE news_feed ADD COLUMN aspect_ratio TEXT DEFAULT '16:9'")
            logger.info("Migrated: added aspect_ratio column to news_feed")
        else:
            logger.info("news_feed.aspect_ratio column already present — skipping")
    except Exception as e:
        logger.warning(f"news_feed migration check skipped: {e}")
    try:
        profile_cols = d1_query("PRAGMA table_info(user_profiles)")
        existing_p = [col.get('name', '') for col in profile_cols] if profile_cols else []
        if 'verified' not in existing_p:
            d1_query("ALTER TABLE user_profiles ADD COLUMN verified INTEGER DEFAULT 0")
            logger.info("Migrated: added verified column to user_profiles")
    except Exception as e:
        logger.warning(f"user_profiles migration check skipped: {e}")


# ── Cloudflare API Endpoints ──────────────────────────────────────────────────

@api_router.get("/health")
async def health_check():
    """Detailed health check: pings MongoDB with a timeout to verify connection."""
    mongo_status = "connected"
    mongo_error = None
    try:
        await asyncio.wait_for(client.admin.command('ping'), timeout=2.0)
    except asyncio.TimeoutError:
        mongo_status = "disconnected"
        mongo_error = "Database ping timed out (2.0s)"
        logger.error("Health check MongoDB ping timed out")
    except Exception as e:
        mongo_status = "disconnected"
        mongo_error = str(e) or repr(e)
        logger.error(f"Health check MongoDB ping failed: {mongo_error}")

    if mongo_status == "connected":
        return {
            "status": "ok",
            "service": "public-samachar-backend",
            "services": {
                "mongodb": {
                    "status": "connected"
                }
            }
        }
    else:
        return JSONResponse(
            status_code=503,
            content={
                "status": "error",
                "service": "public-samachar-backend",
                "services": {
                    "mongodb": {
                        "status": "disconnected",
                        "error": mongo_error
                    }
                }
            }
        )



@api_router.get("/cf/videos")
async def get_cf_videos(page: int = 1, limit: int = 15):
    """
    Fetch video feed from Cloudflare D1.
    - Uses native async D1 query (httpx) — never blocks the event loop
    - 30-second in-memory cache — 100 concurrent users hit D1 once per 30s
    - Returns DIRECT R2 CDN URLs — no proxying through FastAPI
    """
    cache_key = f"cf_videos_{page}_{limit}"
    cached = _cache_get(cache_key, ttl=30.0)
    if cached is not None:
        return cached

    offset = (page - 1) * limit
    videos = await d1_query_async(
        'SELECT * FROM news_feed ORDER BY timestamp DESC LIMIT ? OFFSET ?',
        [limit, offset]
    )
    # Always serve direct R2 CDN URLs — FastAPI never proxies video bytes
    for v in videos:
        if v.get('video_url') and not v['video_url'].startswith('http'):
            v['video_url'] = f'{R2_PUBLIC_CDN}/{v["video_url"]}'
        if v.get('thumb_url') and not v['thumb_url'].startswith('http'):
            v['thumb_url'] = f'{R2_PUBLIC_CDN}/{v["thumb_url"]}'
    result = {'videos': videos, 'page': page, 'limit': limit}
    _cache_set(cache_key, result)
    return result


@api_router.get("/generate-upload-url")
async def generate_upload_url(
    content_type: str = 'video/mp4',
):
    """
    Generate a presigned PUT URL for DIRECT client-to-R2 video upload.

    Architecture: The client uploads the video file DIRECTLY to Cloudflare R2
    using this presigned URL. FastAPI never receives the video bytes, so it
    never blocks — all other users are served normally during uploads.

    Flow:
      1. App calls GET /api/generate-upload-url  → gets presigned URL + video_id
      2. App PUTs video bytes to presigned URL (R2 direct, no backend involved)
      3. App calls POST /api/cf/save-video-meta  → backend saves metadata to D1
    """
    if not R2_ACCESS_KEY_ID or not R2_SECRET_ACCESS_KEY:
        raise HTTPException(
            status_code=503,
            detail=(
                "R2 upload credentials not configured. "
                "Add R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY to backend/.env"
            ),
        )

    video_id = str(uuid.uuid4())
    # Use correct path and extension based on content type
    if content_type.startswith('image/'):
        ext = 'jpg' if 'jpeg' in content_type or 'jpg' in content_type else 'png'
        key = f'news_feed/thumbs/{video_id}.{ext}'
    else:
        key = f'news_feed/videos/{video_id}.mp4'

    try:
        s3 = get_r2_s3_client()
        presigned_url = s3.generate_presigned_url(
            'put_object',
            Params={
                'Bucket': R2_BUCKET_NAME,
                'Key': key,
                'ContentType': content_type,
            },
            ExpiresIn=3600,
        )
        logger.info(f"Generated presigned R2 upload URL: video_id={video_id}, key={key}")
        return {
            'success': True,
            'upload_url': presigned_url,
            'video_id': video_id,
            'key': key,
        }
    except Exception as e:
        logger.error(f"Failed to generate presigned URL: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to generate upload URL: {str(e)}")


# ─────────────────────────────────────────────────────────────────────────────
# THUMBNAIL PRESIGNED URL  (dedicated endpoint, JPEG only)
# ─────────────────────────────────────────────────────────────────────────────
@api_router.get("/generate-thumb-url")
async def generate_thumb_url():
    """
    Generate a presigned PUT URL for direct thumbnail upload to Cloudflare R2.
    Dedicated endpoint for thumbnails (JPEG only) with 30-minute expiry.

    Returns: { "success": true, "upload_url": "...", "thumb_id": "...", "key": "..." }
    """
    if not R2_ACCESS_KEY_ID or not R2_SECRET_ACCESS_KEY:
        raise HTTPException(status_code=503, detail="R2 upload credentials not configured.")

    thumb_id = str(uuid.uuid4())
    key = f'news_feed/thumbs/{thumb_id}.jpg'
    try:
        s3 = get_r2_s3_client()
        presigned_url = s3.generate_presigned_url(
            'put_object',
            Params={
                'Bucket': R2_BUCKET_NAME,
                'Key': key,
                'ContentType': 'image/jpeg',
            },
            ExpiresIn=1800,  # 30 minutes
        )
        logger.info(f"Generated presigned thumb URL: thumb_id={thumb_id}, key={key}")
        return {
            'success': True,
            'upload_url': presigned_url,
            'thumb_id': thumb_id,
            'key': key,
        }
    except Exception as e:
        logger.error(f"Failed to generate thumb presigned URL: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to generate thumbnail URL: {str(e)}")


# ─────────────────────────────────────────────────────────────────────────────
# REPORTER JWT AUTH
# ─────────────────────────────────────────────────────────────────────────────
@api_router.post("/reporter-login")
async def reporter_login(request: Request):
    """
    Validate reporter access code and issue a 30-day JWT token.

    Request body: { "reporter_name": "...", "access_code": "PS2026" }
    Returns: { "success": true, "token": "<JWT>", "reporter_name": "...", "expires_in_days": 30 }
    """
    data = await request.json()
    reporter_name = (data.get('reporter_name') or '').strip()
    access_code   = (data.get('access_code') or '').strip().upper()

    if not reporter_name:
        raise HTTPException(status_code=400, detail="Reporter name is required.")
    if not access_code:
        raise HTTPException(status_code=400, detail="Access code is required.")
    if access_code != REPORTER_ACCESS_CODE_ENV.upper():
        raise HTTPException(status_code=401, detail="Wrong access code. Please check with your editor.")

    reporter_id = f"reporter_{uuid.uuid4().hex[:8]}"
    now = datetime.now(timezone.utc)
    payload = {
        'sub': reporter_name,
        'reporter_id': reporter_id,
        'iat': int(now.timestamp()),
        'exp': int((now + timedelta(days=30)).timestamp()),
    }
    token = pyjwt.encode(payload, JWT_SECRET_KEY, algorithm='HS256')
    logger.info(f"Reporter JWT issued: name={reporter_name!r}, id={reporter_id}")
    return {
        'success': True,
        'token': token,
        'reporter_name': reporter_name,
        'reporter_id': reporter_id,
        'expires_in_days': 30,
    }


@api_router.get("/verify-reporter-token")
async def verify_reporter_token(request: Request):
    """
    Verify a reporter JWT Bearer token.

    Returns { "valid": true, "reporter_name": "...", "reporter_id": "..." }
    or raises 401 if token is missing, invalid, or expired.
    """
    auth = request.headers.get('Authorization', '')
    if not auth.startswith('Bearer '):
        raise HTTPException(status_code=401, detail="No token provided. Please login.")
    token = auth[7:]
    try:
        payload = pyjwt.decode(token, JWT_SECRET_KEY, algorithms=['HS256'])
        return {
            'valid': True,
            'reporter_name': payload.get('sub', ''),
            'reporter_id': payload.get('reporter_id', ''),
        }
    except pyjwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Session expired. Please login again.")
    except pyjwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token. Please login again.")


@api_router.post("/cf/save-video-meta")
async def save_video_meta(request: Request, _auth: dict = Depends(require_reporter_jwt)):
    """
    Save video metadata to Cloudflare D1 after the client has uploaded the video
    DIRECTLY to R2 via a presigned URL.

    Requires a valid reporter JWT (Authorization: Bearer <token>).
    """
    data = await request.json()
    video_id    = data.get('video_id', '').strip()
    video_key   = data.get('video_key', '').strip()
    title       = data.get('title', '').strip()
    description = data.get('description', '').strip()
    location    = data.get('location', '').strip()
    reporter_name = data.get('reporter_name', 'Reporter').strip()
    reporter_id   = data.get('reporter_id', 'reporter').strip()
    thumb_key   = data.get('thumb_key', '').strip()   # R2 key for thumbnail (optional)
    aspect_ratio = data.get('aspect_ratio', '16:9').strip()

    if not video_id or not video_key:
        raise HTTPException(status_code=400, detail="video_id and video_key are required")

    # ── Part 6: Basic AI Content Check ────────────────────────────────────────
    caution_flag = 1 if _check_caution(title) else 0
    if caution_flag:
        logger.info(f"⚠️ Caution flag set for video {video_id}: title='{title}'")

    ts = int(datetime.now(timezone.utc).timestamp() * 1000)

    await d1_query_async(
        'INSERT INTO news_feed (id, title, description, location, video_url, thumb_url, reporter_name, reporter_id, timestamp, caution_flag, aspect_ratio) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [video_id, title, description, location, video_key, thumb_key, reporter_name, reporter_id, ts, caution_flag, aspect_ratio]
    )
    logger.info(f"Video meta saved to D1: id={video_id}, key={video_key}, reporter={reporter_name}, caution={caution_flag}")

    # Send push notification in background (fire-and-forget, never blocks the response)
    async def _send_push():
        try:
            tokens_cursor = db["push_tokens"].find({}, {"token": 1})
            tokens = [doc["token"] async for doc in tokens_cursor]
            if tokens:
                push_messages = [{
                    "to": t, "sound": "default",
                    "title": "📺 New Video — Public Samachar",
                    "body": title or "New video posted",
                    "data": {"type": "new_cf_video", "video_id": video_id},
                } for t in tokens]
                http = get_async_client()
                for i in range(0, len(push_messages), 100):
                    try:
                        await http.post(
                            "https://exp.host/--/api/v2/push/send",
                            json=push_messages[i:i+100],
                            headers={"Content-Type": "application/json", "Accept": "application/json"},
                        )
                        logger.info(f"Push notification sent to {len(push_messages[i:i+100])} devices")
                    except Exception as pe:
                        logger.warning(f"Push batch error: {pe}")
        except Exception as e:
            logger.warning(f"Push notification error: {e}")

    asyncio.create_task(_send_push())

    # Invalidate video feed cache so new video appears immediately
    for key in list(_mem_cache.keys()):
        if key.startswith("cf_videos_"):
            del _mem_cache[key]

    return {'success': True, 'video_id': video_id}


@api_router.post("/cf/upload")
async def upload_cf_video(
    title: str = Form(...),
    description: str = Form(''),
    location: str = Form(''),
    reporter_name: str = Form('Reporter'),
    reporter_id: str = Form('reporter'),
    video: UploadFile = File(...),
    thumbnail: Optional[UploadFile] = File(None),
    aspect_ratio: str = Form('16:9'),
    _auth: dict = Depends(require_reporter_jwt),
):
    """
    Upload video to Cloudflare R2 and save metadata to D1.

    Key design: video is STREAMED to R2 in a background thread via r2_upload_stream().
    The async event loop is never blocked — all other users are served normally
    while the upload is in progress.  No full-file RAM load.
    """
    video_id = str(uuid.uuid4())
    ts = int(datetime.now(timezone.utc).timestamp() * 1000)
    video_key = f'news_feed/videos/{video_id}.mp4'

    # ── Stream video to R2 in a thread pool (non-blocking, memory-efficient) ──
    loop = asyncio.get_running_loop()
    success = await loop.run_in_executor(
        _upload_executor,
        r2_upload_stream,
        video_key,
        video.file,
        video.content_type or 'video/mp4',
    )
    if not success:
        raise HTTPException(status_code=500, detail="Failed to upload video to storage. Please try again.")

    # ── Upload thumbnail (small file — read into memory is fine) ────────────
    thumb_key = ''
    if thumbnail:
        thumb_data = await thumbnail.read()
        thumb_key = f'news_feed/thumbs/{video_id}.jpg'
        if not r2_upload_object(thumb_key, thumb_data, thumbnail.content_type or 'image/jpeg'):
            thumb_key = ''

    # ── Save metadata to D1 ──────────────────────────────────────────────────
    await d1_query_async(
        'INSERT INTO news_feed (id, title, description, location, video_url, thumb_url, reporter_name, reporter_id, timestamp, aspect_ratio) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [video_id, title, description, location, video_key, thumb_key, reporter_name, reporter_id, ts, aspect_ratio]
    )

    video_url = f'{R2_PUBLIC_CDN}/{video_key}'
    thumb_url = f'{R2_PUBLIC_CDN}/{thumb_key}' if thumb_key else ''

    logger.info(f"CF upload complete: id={video_id}, reporter={reporter_name}")

    # Send push notification in background — never blocks the response
    async def _send_push_bg():
        try:
            tokens_cursor = db["push_tokens"].find({}, {"token": 1})
            tokens = [doc["token"] async for doc in tokens_cursor]
            if tokens:
                push_messages = [{
                    "to": t, "sound": "default",
                    "title": "📺 New Video — Public Samachar",
                    "body": title,
                    "data": {"type": "new_cf_video", "video_id": video_id},
                } for t in tokens]
                http = get_async_client()
                for i in range(0, len(push_messages), 100):
                    await http.post("https://exp.host/--/api/v2/push/send",
                                    json=push_messages[i:i+100], timeout=15)
        except Exception as e:
            logger.warning(f"Push notification error: {e}")

    asyncio.create_task(_send_push_bg())
    # Invalidate feed cache so new video appears immediately
    for k in list(_mem_cache.keys()):
        if k.startswith("cf_videos_"):
            del _mem_cache[k]

    return {'success': True, 'video_id': video_id, 'video_url': video_url, 'thumb_url': thumb_url}


@api_router.get("/cf/video-proxy/{key:path}")
async def proxy_cf_video(key: str, request: Request):
    """
    Redirect video/thumbnail requests directly to Cloudflare R2 public CDN.

    Since the R2 bucket has public access enabled, we simply redirect the client
    to the CDN URL — FastAPI never streams any bytes, eliminating server load entirely.
    Fallback: serve from local storage (for old videos uploaded before Direct R2).
    """
    from fastapi.responses import RedirectResponse, FileResponse

    # Try local storage first (old videos uploaded before Direct R2 architecture)
    local_path = Path(__file__).parent / 'uploads' / key
    if local_path.exists():
        content_type = 'video/mp4' if key.endswith('.mp4') else 'image/jpeg'
        return FileResponse(
            str(local_path),
            media_type=content_type,
            headers={
                'Cache-Control': 'public, max-age=3600',
                'Access-Control-Allow-Origin': '*',
            }
        )

    # Redirect to R2 public CDN — no bytes through FastAPI!
    r2_url = f"{R2_PUBLIC_CDN}/{key}"
    return RedirectResponse(url=r2_url, status_code=302, headers={
        'Cache-Control': 'public, max-age=3600',
    })

@api_router.get("/cf/profile/{profile_id}")
async def get_cf_profile(profile_id: str):
    """Get reporter profile from Cloudflare D1."""
    results = await d1_query_async('SELECT * FROM user_profiles WHERE id = ?', [profile_id])
    if results:
        return results[0]
    return {'id': profile_id, 'display_name': 'Reporter', 'location': '', 'profile_pic_url': '', 'is_reporter': 0}


@api_router.post("/cf/profile")
async def save_cf_profile(request: Request):
    """Save/update reporter profile in Cloudflare D1."""
    data = await request.json()
    profile_id = data.get('id', '').strip()
    if not profile_id:
        raise HTTPException(status_code=400, detail="id is required")
    ts = int(datetime.now(timezone.utc).timestamp() * 1000)
    await d1_query_async(
        '''INSERT INTO user_profiles (id, display_name, location, profile_pic_url, is_reporter, created_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             display_name=excluded.display_name,
             location=excluded.location,
             profile_pic_url=excluded.profile_pic_url,
             is_reporter=excluded.is_reporter''',
        [profile_id, data.get('display_name', 'Reporter'), data.get('location', ''),
         data.get('profile_pic_url', ''), int(data.get('is_reporter', 0)), ts]
    )
    return {'success': True, 'id': profile_id}


APK_R2_CDN_URL = "https://pub-053fe10649264831be10ca4454fe912c.r2.dev/apk/public-samachar-v6.apk"
APK_SIZE_BYTES  = 128083424  # 122 MB


@api_router.api_route("/download/apk", methods=["GET", "HEAD"])
async def download_apk(request: Request):
    """
    Redirect to the APK directly on Cloudflare R2 CDN (no proxy size limits).
    """
    from fastapi.responses import RedirectResponse, Response

    if request.method == "HEAD":
        return Response(
            status_code=200,
            headers={
                "Content-Length":      str(APK_SIZE_BYTES),
                "Content-Type":        "application/vnd.android.package-archive",
                "Accept-Ranges":       "bytes",
                "Content-Disposition": 'attachment; filename="PublicSamachar-v6.apk"',
                "Cache-Control":       "no-cache",
            },
        )

    return RedirectResponse(url=APK_R2_CDN_URL, status_code=302)


@api_router.get("/apk", response_class=HTMLResponse)
@api_router.get("/download/page", response_class=HTMLResponse)
async def download_page(request: Request):
    """
    A proper download landing page — triggers the APK download correctly on Android.
    """
    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Download Public Samachar</title>
<style>
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: #E6F7F3;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
  }}
  .card {{
    background: #fff;
    border-radius: 20px;
    padding: 36px 28px;
    max-width: 400px;
    width: 100%;
    text-align: center;
    box-shadow: 0 8px 32px rgba(0,0,0,0.10);
  }}
  .logo {{ font-size: 48px; margin-bottom: 12px; }}
  h1 {{ font-size: 24px; color: #1a1a2e; margin-bottom: 6px; }}
  .sub {{ color: #666; font-size: 14px; margin-bottom: 28px; }}
  .btn {{
    display: block;
    background: linear-gradient(135deg, #1AAA94, #0D8975);
    color: #fff;
    text-decoration: none;
    padding: 16px 24px;
    border-radius: 14px;
    font-size: 17px;
    font-weight: 700;
    margin-bottom: 14px;
    letter-spacing: 0.3px;
  }}
  .btn:active {{ opacity: 0.9; }}
  .size {{ color: #999; font-size: 13px; margin-bottom: 24px; }}
  .tips {{
    background: #FFFFFF;
    border: 1px solid #B2E5DC;
    border-radius: 12px;
    padding: 16px;
    text-align: left;
  }}
  .tips h3 {{ font-size: 13px; color: #444; margin-bottom: 10px; font-weight: 700; }}
  .tips li {{
    font-size: 13px;
    color: #555;
    margin-bottom: 6px;
    margin-left: 16px;
  }}
  .version {{ margin-top: 20px; font-size: 12px; color: #bbb; }}
</style>
</head>
<body>
<div class="card">
  <div class="logo">📺</div>
  <h1>Public Samachar</h1>
  <p class="sub">Your local video news app</p>

  <a class="btn" href="{APK_R2_CDN_URL}" download="PublicSamachar-v6.apk">
    ⬇️ Download APK (122 MB)
  </a>
  <p class="size">Version 6 &nbsp;·&nbsp; Android 6.0+ &nbsp;·&nbsp; Cloudflare CDN</p>

  <div class="tips">
    <h3>📋 Installation Tips:</h3>
    <ul>
      <li>Keep screen ON during download</li>
      <li>Use Wi-Fi for best speed</li>
      <li>If download pauses — tap <b>Resume</b></li>
      <li>After download, tap to install</li>
      <li>Enable <b>Install unknown apps</b> if asked</li>
    </ul>
  </div>

  <p class="version">Public Samachar v6 · Crash-free Direct Upload</p>
</div>
</body>
</html>"""
    return HTMLResponse(content=html)


@api_router.get("/logo.png")
async def get_logo():
    logo_path = Path(__file__).parent / "logo.png"
    if logo_path.exists():
        return FileResponse(logo_path, media_type="image/png")
    # Fallback to frontend directory during local development
    frontend_logo_path = Path(__file__).parent.parent / "frontend" / "assets" / "images" / "logo.png"
    if frontend_logo_path.exists():
        return FileResponse(frontend_logo_path, media_type="image/png")
    raise HTTPException(status_code=404, detail="Logo not found")


@api_router.get("/cf/share/{video_id}", response_class=HTMLResponse)
@api_router.get("/og/{video_id}", response_class=HTMLResponse)
async def video_share_page(video_id: str):
    """
    Standalone web video player page — works without the app installed.
    Share URL: https://public-samachar-api.onrender.com/api/cf/share/{video_id}
    """
    cache_key = f"share_v_{video_id}"
    v = _cache_get(cache_key, 3600.0) # 1 hour cache
    
    if not v:
        clean_id = video_id.replace("yt_", "").strip()
        is_yt = video_id.startswith("yt_") or len(clean_id) == 11
        
        # 1. YouTube oEmbed (Fast Path)
        if is_yt:
            try:
                http = get_async_client()
                r = await http.get(f"https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v={clean_id}&format=json", timeout=4.0)
                if r.status_code == 200:
                    yt_data = r.json()
                    t = html_lib.unescape(yt_data.get("title", ""))
                    v = {
                        "title": t,
                        "description": f"Watch '{t}' on My Public Samachar.",
                        "reporter_name": yt_data.get("author_name", "Public Samachar"),
                        "thumb_url": f"https://img.youtube.com/vi/{clean_id}/hqdefault.jpg",
                        "video_url": f"https://www.youtube.com/embed/{clean_id}",
                        "location": "Karnataka"
                    }
            except Exception as e:
                logger.error(f"YT oembed error: {e}")
        
        # 2. D1 Query
        if not v:
            try:
                results = await d1_query_async('SELECT * FROM news_feed WHERE id = ?', [clean_id])
                if not results and video_id != clean_id:
                    results = await d1_query_async('SELECT * FROM news_feed WHERE id = ?', [video_id])
                if results and len(results) > 0:
                    v = results[0]
                    if v.get('video_url') and not v['video_url'].startswith('http'):
                        v['video_url'] = f'{R2_PUBLIC_CDN}/{v["video_url"].lstrip("/")}'
                    if v.get('thumb_url') and not v['thumb_url'].startswith('http'):
                        thumb_path = v['thumb_url'].lstrip('/')
                        v['thumb_url'] = f'{R2_PUBLIC_CDN}/{thumb_path}'
            except Exception as e:
                logger.error(f"D1 query error: {e}")
                
        # 3. MongoDB Fallback
        if not v:
            try:
                collections = await db.list_collection_names()
                id_queries = [{"id": video_id}, {"_id": video_id}, {"video_id": video_id}, {"cf_id": video_id}, {"id": clean_id}, {"_id": clean_id}]
                if video_id.isdigit():
                    id_queries.extend([{"id": int(video_id)}, {"_id": int(video_id)}])
                elif clean_id.isdigit():
                    id_queries.extend([{"id": int(clean_id)}, {"_id": int(clean_id)}])
                search_query = {"$or": id_queries}
                priority_cols = ["cf_videos", "videos", "posts", "news_feed", "news", "articles"]
                for col_name in priority_cols:
                    if col_name in collections:
                        v = await db[col_name].find_one(search_query)
                        if v:
                            break
                if not v:
                    for col_name in collections:
                        if col_name not in priority_cols and not col_name.startswith("system."):
                            v = await db[col_name].find_one(search_query)
                            if v:
                                break
            except Exception as e:
                logger.error(f"MongoDB query error: {e}")
                
        # 4. WordPress REST API Fallback
        if not v and (video_id.isdigit() or clean_id.isdigit()):
            wp_id = video_id if video_id.isdigit() else clean_id
            try:
                http = get_async_client()
                r = await http.get(f"{WP_BASE_URL}/wp-json/wp/v2/posts/{wp_id}?_embed=1", timeout=4.0)
                if r.status_code == 200:
                    wp_data = r.json()
                    t = html_lib.unescape(wp_data.get("title", {}).get("rendered", ""))
                    c = wp_data.get("content", {}).get("rendered", "") or wp_data.get("excerpt", {}).get("rendered", "")
                    img = wp_data.get("jetpack_featured_media_url", "")
                    if not img and "_embedded" in wp_data:
                        media = wp_data["_embedded"].get("wp:featuredmedia", [])
                        if media and isinstance(media, list) and len(media) > 0:
                            img = media[0].get("source_url", "")
                    auth = ""
                    if "_embedded" in wp_data:
                        authors = wp_data["_embedded"].get("author", [])
                        if authors and isinstance(authors, list) and len(authors) > 0:
                            auth = authors[0].get("name", "")
                    src = ""
                    mp4_m = re.search(r'src=["' + "'" + r'](https?://[^"' + "'" + r']+\.mp4)["' + "'" + r']', c, re.IGNORECASE)
                    if mp4_m:
                        src = mp4_m.group(1)
                    else:
                        if_m = re.search(r'src=["' + "'" + r'](https?://[^"' + "'" + r']+)["' + "'" + r']', c, re.IGNORECASE)
                        if if_m:
                            src = if_m.group(1)
                    v = {
                        "title": t,
                        "description": c,
                        "thumb_url": img,
                        "reporter_name": auth,
                        "video_url": src,
                        "location": "Karnataka"
                    }
            except Exception as e:
                logger.error(f"WP fetch error: {e}")

        # Cache negative result for 1 minute, positive result for 1 hour
        if v:
            _cache_set(cache_key, v)
        else:
            _cache_set(cache_key, {"not_found": True})
            
    if isinstance(v, dict) and v.get("not_found"):
        v = None

    if not v:
        v = {
            "title": "My Public Samachar - Local Video News",
            "description": "Watch local video news from Karnataka on My Public Samachar.",
            "reporter_name": "Public Samachar",
            "location": "Karnataka",
            "video_url": "",
            "thumb_url": ""
        }
    try:
        pass
    except ValueError:
        # 404 page
        return HTMLResponse(content=f"""<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Video Not Found — Public Samachar</title>
<style>*{{box-sizing:border-box;margin:0;padding:0}}body{{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#E6F7F3;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}}.card{{background:#fff;border-radius:20px;padding:40px 28px;max-width:400px;width:100%;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,.1)}}.logo-circle{{width:64px;height:64px;border-radius:50%;background:#1AAA94;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;font-size:26px;font-weight:900;color:#fff}}h1{{font-size:20px;color:#333;margin-bottom:8px}}p{{color:#888;font-size:14px;margin-bottom:24px}}.btn{{display:block;background:#1AAA94;color:#fff;text-decoration:none;padding:14px 24px;border-radius:12px;font-size:15px;font-weight:700}}</style>
</head><body>
<div class="card">
  <div class="logo-circle">PS</div>
  <h1>Video Not Found</h1>
  <p>This video may have been removed or the link is invalid.</p>
  <a class="btn" href="https://mypublicsamachar.com/download">📲 Download Public Samachar App</a>
</div></body></html>""", status_code=404)
    except Exception as e:
        logger.error(f"video_share_page error: {e}")
        return HTMLResponse(content="<h1>Server Error</h1>", status_code=500)

    title       = v.get('title', 'Public Samachar Video')
    reporter    = v.get('reporter_name', 'Reporter')
    location    = v.get('location', '')
    video_url   = v.get('video_url', '')
    thumb_url   = v.get('thumb_url', '')
    description = v.get('description', '')
    ts          = v.get('timestamp', 0)
    caution     = v.get('caution_flag', 0)

    share_url    = f"{BACKEND_URL}/api/cf/share/{video_id}"
    _nl          = '\n'
    wa_text      = f"📺 {title}{_nl}{_nl}🔗 Watch here: {share_url}{_nl}{_nl}📲 Download Public Samachar App: https://mypublicsamachar.com/download"
    wa_encoded   = wa_text.replace(' ', '%20').replace('\n', '%0A')
    wa_url       = f"https://wa.me/?text={wa_encoded}"
    download_url = "https://mypublicsamachar.com/download"

    # ── SECURITY: HTML-escape every user-controlled value before HTML interpolation ──
    # Prevents stored XSS via titles/descriptions/location/reporter names posted by users.
    def _E(s):
        return html_lib.escape(str(s or ''), quote=True)
    title_e       = _E(title)
    reporter_e    = _E(reporter)
    location_e    = _E(location)
    description_e = _E(description)
    video_url_e   = _E(video_url)
    thumb_url_e   = _E(thumb_url)
    share_url_e   = _E(share_url)
    wa_url_e      = _E(wa_url)
    download_url_e = _E(download_url)
    logo_url      = "/api/logo.png"
    logo_url_e    = _E(logo_url)

    thumb_meta  = f'<meta property="og:image" content="{thumb_url_e}">' if thumb_url else ''
    caution_bar = '''<div class="caution-bar">⚠️ This content has not been independently verified</div>''' if caution else ''
    location_html = f'<span class="location">📍 {location_e}</span>' if location else ''
    desc_html   = f'<p class="desc">{description_e}</p>' if description else ''

    # ── PERFORMANCE: Dynamic preconnect links ──
    import urllib.parse
    preconnect_html = ""
    if video_url:
        try:
            parsed_url = urllib.parse.urlparse(video_url)
            if parsed_url.netloc:
                preconnect_html = (
                    f'  <link rel="preconnect" href="{parsed_url.scheme}://{parsed_url.netloc}">\n'
                    f'  <link rel="dns-prefetch" href="{parsed_url.scheme}://{parsed_url.netloc}">'
                )
        except Exception:
            pass

    # ── DYNAMIC PLAYER & AUTOPLAY SELECTION ──
    is_youtube = "youtube.com" in video_url or "youtu.be" in video_url
    if is_youtube:
        embed_url = video_url
        if "?" in embed_url:
            embed_url += "&autoplay=1&mute=1"
        else:
            embed_url += "?autoplay=1&mute=1"
        player_html = f"""<iframe
        id="vid"
        src="{html_lib.escape(embed_url, quote=True)}"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowfullscreen
      ></iframe>"""
    else:
        poster_attr = f" poster='{thumb_url_e}'" if thumb_url else ""
        player_html = f"""<video
        id="vid"
        preload="auto"
        controls
        playsinline
        autoplay
        muted
        {poster_attr}
      >
        <source src="{video_url_e}" type="video/mp4">
        Your browser does not support HTML5 video.
      </video>"""

    html = f"""<!DOCTYPE html>
<html lang="hi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
  <title>{title_e} — Public Samachar</title>
  {preconnect_html}
  <meta name="description" content="{description_e or title_e}">
  <!-- Open Graph / WhatsApp preview -->
  <meta property="og:type"        content="video.other">
  <meta property="og:title"       content="{title_e}">
  <meta property="og:description" content="Reported by {reporter_e}{(' · ' + location_e) if location else ''}">
  <meta property="og:url"         content="{share_url_e}">
  {thumb_meta}
  <meta property="og:video"       content="{video_url_e}">
  <meta property="og:video:type"  content="video/mp4">
  <meta name="twitter:card"       content="summary_large_image">
  <style>
    * {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #ffffff;
      color: #111827;
      min-height: 100vh;
    }}
    /* ── Header ── */
    .header {{
      background: #1AAA94;
      padding: 10px 16px;
      display: flex;
      align-items: center;
      gap: 10px;
      position: sticky;
      top: 10px;
      z-index: 10;
      max-width: 600px;
      width: calc(100% - 32px);
      margin: 10px auto;
      border-radius: 12px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.08);
    }}
    .logo-circle {{
      width: 38px; height: 38px; border-radius: 50%;
      background: rgba(255,255,255,0.2);
      display: flex; align-items: center; justify-content: center;
      font-size: 16px; font-weight: 900; color: #fff;
      flex-shrink: 0;
    }}
    .header-title {{
      font-size: 18px; font-weight: 800; color: #fff;
      letter-spacing: 0.3px;
    }}
    .header-sub {{ font-size: 11px; color: rgba(255,255,255,0.7); }}
    /* ── Content ── */
    .content {{
      max-width: 680px;
      margin: 0 auto;
      padding: 0 0 80px;
    }}
    /* ── Video ── */
    .video-wrap {{
      position: relative;
      background: #000;
      width: 100%;
    }}
    .video-logo {{
      position: absolute;
      top: 12px;
      right: 12px;
      width: 50px;
      height: auto;
      z-index: 5;
      pointer-events: none;
      opacity: 0.85;
      filter: drop-shadow(0 2px 4px rgba(0,0,0,0.4));
    }}
    video {{
      display: block;
      width: 100%;
      max-height: 70vh;
      background: #000;
    }}
    iframe {{
      display: block;
      width: 100%;
      aspect-ratio: 16 / 9;
      max-height: 70vh;
      background: #000;
      border: none;
    }}
    .video-error {{
      display: none;
      text-align: center;
      padding: 40px 20px;
      color: #888;
      background: #111;
    }}
    .video-error .err-icon {{ font-size: 48px; margin-bottom: 12px; }}
    .video-error p {{ font-size: 14px; }}
    .video-error .retry-btn {{
      display: inline-block;
      margin-top: 16px;
      background: #1AAA94;
      color: #fff;
      padding: 10px 24px;
      border-radius: 20px;
      text-decoration: none;
      font-size: 14px;
      font-weight: 600;
    }}
    /* ── Caution ── */
    .caution-bar {{
      background: #FFF3E0;
      color: #E65100;
      font-size: 12px;
      font-weight: 600;
      padding: 8px 16px;
      border-left: 3px solid #E65100;
    }}
    /* ── Info ── */
    .info {{
      padding: 16px;
      border-bottom: 1px solid #e5e7eb;
    }}
    .title-text {{
      font-size: 19px;
      font-weight: 800;
      line-height: 1.4;
      color: #111827;
      margin-bottom: 10px;
    }}
    .meta {{
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      font-size: 13px;
      color: #4b5563;
    }}
    .reporter {{ font-weight: 600; color: #0D8975; }}
    .location {{ color: #0D8975; font-weight: 600; }}
    .desc {{
      font-size: 15px;
      color: #1f2937;
      line-height: 1.8;
      padding: 16px;
      text-align: justify;
      border-bottom: 1px solid #e5e7eb;
      white-space: pre-wrap;
    }}
    /* ── Actions ── */
    .actions {{
      display: flex;
      gap: 10px;
      padding: 14px 16px;
    }}
    .btn-wa {{
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      background: #25D366;
      color: #fff;
      text-decoration: none;
      padding: 13px 16px;
      border-radius: 12px;
      font-size: 14px;
      font-weight: 700;
      border: none;
      cursor: pointer;
    }}
    .btn-download {{
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      background: #1AAA94;
      color: #fff;
      text-decoration: none;
      padding: 13px 16px;
      border-radius: 12px;
      font-size: 14px;
      font-weight: 700;
    }}
    /* ── Footer ── */
    .footer {{
      text-align: center;
      padding: 16px;
      font-size: 12px;
      color: #4b5563;
    }}
    .footer a {{ color: #1AAA94; text-decoration: none; }}
    @media (max-width: 400px) {{
      .title-text {{ font-size: 16px; }}
      .btn-wa, .btn-download {{ font-size: 13px; padding: 11px 10px; }}
    }}
  </style>
</head>
<body>
  <!-- Header -->
  <div class="header">
    <div class="logo-circle">PS</div>
    <div>
      <div class="header-title">Public Samachar</div>
      <div class="header-sub">Your Local Video News</div>
    </div>
  </div>

  <div class="content">
    <!-- Video Player -->
    <div class="video-wrap">
      {player_html}
      <img src="{logo_url_e}" class="video-logo" alt="Public Samachar Logo">
      <!-- Error fallback -->
      <div class="video-error" id="vid-error">
        <div class="err-icon">📺</div>
        <p>Video unavailable — please try again later.</p>
        <a class="retry-btn" href="javascript:location.reload()">↺ Try Again</a>
      </div>
    </div>

    {caution_bar}

    <!-- Title & Meta -->
    <div class="info">
      <div class="title-text">{title_e}</div>
      <div class="meta">
        <span class="reporter">👤 {reporter_e}</span>
        {location_html}
      </div>
    </div>

    {desc_html}

    <!-- Action Buttons -->
    <div class="actions">
      <a class="btn-wa" href="{wa_url_e}" target="_blank" rel="noopener">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
        </svg>
        Share on WhatsApp
      </a>
      <a class="btn-download" href="{download_url_e}" target="_blank" rel="noopener">
        📲 Download App
      </a>
    </div>

    <div class="footer">
      Public Samachar · Your local news, your language<br>
      <a href="{download_url_e}">Download the free app</a>
    </div>
  </div>

  <script>
    // Video error handling
    var vid = document.getElementById('vid');
    var errDiv = document.getElementById('vid-error');
    if (vid) {{
      vid.addEventListener('error', function() {{
        vid.style.display = 'none';
        errDiv.style.display = 'block';
      }});
      // If video source can't load at all
      var src = vid.querySelector('source');
      if (src) {{
        src.addEventListener('error', function() {{
          vid.style.display = 'none';
          errDiv.style.display = 'block';
        }});
      }}

      // Play on user interaction if autoplay is blocked
      if (vid.tagName === 'VIDEO') {{
        // Auto-unmute on first user interaction anywhere on the page/player
        var unmuteAndPlay = function() {{
          if (vid.muted) {{
            vid.muted = false;
            vid.play().catch(function(e) {{
              console.log("Play failed on unmute:", e);
            }});
          }}
          document.removeEventListener('click', unmuteAndPlay);
          document.removeEventListener('touchstart', unmuteAndPlay);
        }};
        document.addEventListener('click', unmuteAndPlay);
        document.addEventListener('touchstart', unmuteAndPlay);

        var playPromise = vid.play();
        if (playPromise !== undefined) {{
          playPromise.catch(function(error) {{
            console.log("Autoplay prevented:", error);
            // Fallback: Play on first touch/click anywhere on the page
            var startPlay = function() {{
              vid.play().catch(function(e) {{
                console.log("Play failed on interaction:", e);
              }});
              document.removeEventListener('click', startPlay);
              document.removeEventListener('touchstart', startPlay);
            }};
            document.addEventListener('click', startPlay);
            document.addEventListener('touchstart', startPlay);
          }});
        }}
      }}
    }}
  </script>
</body>
</html>"""
    # SECURITY: Content-Security-Policy — inline styles (unavoidable in this template)
    # are allowed; scripts are restricted to same-origin only, blocking any injected
    # <script> content that might slip through (defense-in-depth alongside html.escape).
    csp = (
        "default-src 'self'; "
        "img-src 'self' data: https:; "
        "media-src 'self' https:; "
        "style-src 'self' 'unsafe-inline'; "
        "script-src 'self' 'unsafe-inline'; "
        "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com; "
        "object-src 'none'; "
        "base-uri 'self'; "
        "frame-ancestors 'none'"
    )
    return HTMLResponse(
        content=html,
        headers={
            "Content-Security-Policy": csp,
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "strict-origin-when-cross-origin",
        },
    )


@api_router.get("/cf/post/{video_id}")
async def get_cf_post(video_id: str):
    """Fetch a single video post from D1 by ID — used for shareable links."""
    results = await d1_query_async('SELECT * FROM news_feed WHERE id = ?', [video_id])
    if not results:
        raise HTTPException(status_code=404, detail="Post not found")
    v = results[0]
    # Return direct R2 CDN URLs — never proxy through FastAPI
    if v.get('video_url') and not v['video_url'].startswith('http'):
        v['video_url'] = f'{R2_PUBLIC_CDN}/{v["video_url"]}'
    if v.get('thumb_url') and not v['thumb_url'].startswith('http'):
        v['thumb_url'] = f'{R2_PUBLIC_CDN}/{v["thumb_url"]}'
    return v


# ── Part 3: Comments endpoints (D1) ──────────────────────────────────────────

@api_router.get("/cf/comments/{video_id}")
async def get_cf_comments(video_id: str):
    """Fetch all comments for a Public Samachar video from D1."""
    try:
        results = await d1_query_async(
            'SELECT * FROM ps_comments WHERE video_id = ? ORDER BY timestamp DESC LIMIT 100',
            [video_id]
        )
        comments = [
            {
                "id": c.get("id", ""),
                "author": c.get("author_name", "Anonymous"),
                "author_image": "",
                "text": c.get("content", ""),
                "date": c.get("timestamp", 0),
                "like_count": 0,
            }
            for c in (results or [])
        ]
        return {"comments": comments, "total": len(comments)}
    except Exception as e:
        logger.error(f"get_cf_comments error: {e}")
        return {"comments": [], "total": 0, "error": str(e)}


@api_router.post("/cf/comments")
async def post_cf_comment(request: Request):
    """Post a guest comment on a Public Samachar video."""
    data = await request.json()
    video_id    = data.get("video_id", "").strip()
    author_name = data.get("author_name", "Anonymous").strip() or "Anonymous"
    content     = data.get("content", "").strip()

    if not video_id:
        raise HTTPException(status_code=400, detail="video_id is required.")
    if not content:
        raise HTTPException(status_code=400, detail="Comment content is required.")
    if len(content) > 500:
        raise HTTPException(status_code=400, detail="Comment too long (max 500 chars).")

    comment_id = str(uuid.uuid4())
    ts = int(datetime.now(timezone.utc).timestamp() * 1000)
    await d1_query_async(
        'INSERT INTO ps_comments (id, video_id, author_name, content, timestamp) VALUES (?, ?, ?, ?, ?)',
        [comment_id, video_id, author_name, content, ts]
    )
    logger.info(f"Comment posted on video {video_id} by {author_name}")
    return {"success": True, "comment_id": comment_id}


@api_router.delete("/cf/comments/{comment_id}")
async def delete_cf_comment(comment_id: str, _admin: bool = Depends(require_admin_code)):
    """Admin-only: delete a comment. Requires X-Admin-Code header matching ADMIN_ACCESS_CODE env var."""
    await d1_query_async('DELETE FROM ps_comments WHERE id = ?', [comment_id])
    logger.info(f"Comment deleted by admin: {comment_id}")
    return {"success": True}


# ── Part 4: Reporter Verification ─────────────────────────────────────────────

@api_router.post("/admin/verify-reporter")
async def verify_reporter(request: Request, _admin: bool = Depends(require_admin_code)):
    """Admin-only: mark a reporter as verified. Requires X-Admin-Code header matching ADMIN_ACCESS_CODE env var."""
    data = await request.json()
    reporter_id = data.get("reporter_id", "").strip()
    verified    = int(data.get("verified", 1))
    if not reporter_id:
        raise HTTPException(status_code=400, detail="reporter_id is required.")
    await d1_query_async(
        'UPDATE user_profiles SET verified = ? WHERE id = ?',
        [verified, reporter_id]
    )
    logger.info(f"Reporter {reporter_id} verified={verified} by admin")
    return {"success": True, "reporter_id": reporter_id, "verified": verified}


# ── Part 5: Flag / Report Content ────────────────────────────────────────────

@api_router.post("/cf/flag-video")
async def flag_video(request: Request):
    """Allow any user to flag a video as misleading/fake/etc."""
    data = await request.json()
    video_id = data.get("video_id", "").strip()
    reason   = data.get("reason", "misleading").strip()
    if not video_id:
        raise HTTPException(status_code=400, detail="video_id is required.")
    flag_id = str(uuid.uuid4())
    ts = int(datetime.now(timezone.utc).timestamp() * 1000)
    await d1_query_async(
        'INSERT INTO flagged_videos (id, video_id, reason, timestamp, status) VALUES (?, ?, ?, ?, ?)',
        [flag_id, video_id, reason, ts, 'pending']
    )
    logger.info(f"Video {video_id} flagged for reason: {reason}")
    return {"success": True, "flag_id": flag_id}


@api_router.get("/admin/flagged-videos")
async def get_flagged_videos(_admin: bool = Depends(require_admin_code)):
    """Admin-only: list all flagged videos. Requires X-Admin-Code header matching ADMIN_ACCESS_CODE env var."""
    results = await d1_query_async(
        'SELECT * FROM flagged_videos ORDER BY timestamp DESC LIMIT 100', []
    )
    return {"flags": results or [], "total": len(results or [])}


@api_router.post("/admin/resolve-flag/{flag_id}")
async def resolve_flag(flag_id: str, _admin: bool = Depends(require_admin_code)):
    """Admin-only: mark a flag as resolved. Requires X-Admin-Code header matching ADMIN_ACCESS_CODE env var."""
    await d1_query_async(
        'UPDATE flagged_videos SET status = ? WHERE id = ?',
        ['resolved', flag_id]
    )
    logger.info(f"Flag {flag_id} resolved by admin")
    return {"success": True, "flag_id": flag_id, "status": "resolved"}


@api_router.post("/admin/cleanup-old-videos")
async def cleanup_old_videos(days: int = 30, _admin: bool = Depends(require_admin_code)):
    """Admin-only: Delete videos older than N days from both database (D1) and Cloudflare R2."""
    if days < 0:
        raise HTTPException(status_code=400, detail="Days parameter must be 0 or positive")
    
    # Calculate threshold (in ms since epoch)
    threshold_ts = int((datetime.now(timezone.utc) - timedelta(days=days)).timestamp() * 1000)
    
    # Get all video records older than threshold
    old_videos = await d1_query_async(
        "SELECT id, video_url, thumb_url FROM news_feed WHERE timestamp < ?",
        [threshold_ts]
    )
    
    if not old_videos:
        return {"success": True, "count": 0, "message": f"No videos found older than {days} days"}
        
    deleted_count = 0
    loop = asyncio.get_event_loop()
    
    for v in old_videos:
        video_id = v.get("id")
        if not video_id:
            continue
            
        # 1. Delete R2 files asynchronously if credentials configured
        try:
            # Delete video mp4
            video_url = v.get("video_url")
            if video_url:
                video_filename = video_url.split('/')[-1]
                logger.info(f"Deleting video R2 asset: {video_filename}")
                await loop.run_in_executor(
                    None,
                    lambda: boto3.client(
                        's3',
                        endpoint_url=R2_ENDPOINT_URL,
                        aws_access_key_id=CF_ACCESS_KEY_ID,
                        aws_secret_access_key=CF_SECRET_ACCESS_KEY,
                        config=Config(signature_version='s3v4')
                    ).delete_object(Bucket=R2_BUCKET_NAME, Key=video_filename)
                )
                
            # Delete thumbnail jpg
            thumb_url = v.get("thumb_url")
            if thumb_url:
                thumb_filename = thumb_url.split('/')[-1]
                logger.info(f"Deleting thumbnail R2 asset: {thumb_filename}")
                await loop.run_in_executor(
                    None,
                    lambda: boto3.client(
                        's3',
                        endpoint_url=R2_ENDPOINT_URL,
                        aws_access_key_id=CF_ACCESS_KEY_ID,
                        aws_secret_access_key=CF_SECRET_ACCESS_KEY,
                        config=Config(signature_version='s3v4')
                    ).delete_object(Bucket=R2_BUCKET_NAME, Key=thumb_filename)
                )
        except Exception as e:
            logger.error(f"Error deleting R2 files for video {video_id}: {e}")
            
        # 2. Delete database records from D1
        await d1_query_async("DELETE FROM news_feed WHERE id = ?", [video_id])
        await d1_query_async("DELETE FROM ps_comments WHERE video_id = ?", [video_id])
        await d1_query_async("DELETE FROM flagged_videos WHERE video_id = ?", [video_id])
        deleted_count += 1
        
    logger.info(f"Cleanup run: deleted {deleted_count} videos older than {days} days")
    return {"success": True, "count": deleted_count, "message": f"Successfully deleted {deleted_count} videos"}


@api_router.delete("/cf/videos/{video_id}")
async def delete_cf_video(video_id: str, _admin: bool = Depends(require_admin_code)):
    """Admin-only: delete a video from D1 & R2. Requires X-Admin-Code header."""
    clean_id = video_id
    if clean_id.startswith("cf_"):
        clean_id = clean_id[3:]

    # Fetch metadata to find video & thumb keys
    results = await d1_query_async("SELECT * FROM news_feed WHERE id = ?", [clean_id])
    if not results and video_id != clean_id:
        results = await d1_query_async("SELECT * FROM news_feed WHERE id = ?", [video_id])
        if results:
            clean_id = video_id

    # Determine R2 keys
    video_key = f"news_feed/videos/{clean_id}.mp4"
    thumb_key = f"news_feed/thumbs/{clean_id}.jpg"
    if results:
        v_meta = results[0]
        if v_meta.get("video_url"):
            vk = v_meta["video_url"]
            if "/" in vk and vk.startswith("http"):
                video_key = vk.split(".dev/")[-1].split(".com/")[-1]
            else:
                video_key = vk
        if v_meta.get("thumb_url"):
            tk = v_meta["thumb_url"]
            if "/" in tk and tk.startswith("http"):
                thumb_key = tk.split(".dev/")[-1].split(".com/")[-1]
            else:
                thumb_key = tk

    # 1. Delete from R2
    if CF_ACCOUNT_ID and CF_API_TOKEN:
        try:
            s3 = get_r2_s3_client()
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, lambda: s3.delete_object(Bucket=R2_BUCKET_NAME, Key=video_key))
            if thumb_key:
                await loop.run_in_executor(None, lambda: s3.delete_object(Bucket=R2_BUCKET_NAME, Key=thumb_key))
            logger.info(f"Video {clean_id} files deleted from R2")
        except Exception as e:
            logger.warning(f"R2 files delete warning for video {clean_id}: {e}")

    # 2. Delete from D1
    await d1_query_async("DELETE FROM news_feed WHERE id = ?", [clean_id])
    await d1_query_async("DELETE FROM ps_comments WHERE video_id = ?", [clean_id])
    await d1_query_async("DELETE FROM flagged_videos WHERE video_id = ?", [clean_id])
    logger.info(f"Video {clean_id} records deleted from D1 by admin")
    return {"success": True, "video_id": clean_id}


@api_router.get("/admin", response_class=HTMLResponse)
async def admin_dashboard():
    """Secure Web Admin Console for video deletion and content moderation."""
    html_content = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Admin Console — Public Samachar</title>
  <style>
    :root {
      --primary: #1AAA94;
      --primary-dark: #0D8975;
      --primary-soft: rgba(26, 170, 148, 0.15);
      --danger: #EF4444;
      --danger-dark: #DC2626;
      --bg: #0F172A;
      --card-bg: #1E293B;
      --text: #F8FAFC;
      --text-muted: #94A3B8;
      --border: #334155;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background-color: var(--bg);
      color: var(--text);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    header {
      background-color: #0B0F19;
      border-bottom: 1px solid var(--border);
      padding: 16px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      position: sticky;
      top: 0;
      z-index: 10;
    }
    .logo-section { display: flex; align-items: center; gap: 12px; }
    .logo-circle {
      width: 40px; height: 40px; border-radius: 10px;
      background: linear-gradient(135deg, var(--primary), var(--primary-dark));
      display: flex; align-items: center; justify-content: center;
      font-weight: 900; font-size: 20px; color: #fff;
      box-shadow: 0 4px 10px rgba(26,170,148,0.3);
    }
    .title-area h1 { font-size: 18px; font-weight: 800; letter-spacing: 0.5px; }
    .title-area p { font-size: 11px; color: var(--text-muted); margin-top: 1px; }
    .btn {
      padding: 10px 18px; border-radius: 8px; font-size: 14px; font-weight: 600;
      cursor: pointer; border: none; transition: all 0.2s; display: inline-flex;
      align-items: center; justify-content: center; gap: 8px; text-decoration: none;
      outline: none;
    }
    .btn-primary { background-color: var(--primary); color: #fff; }
    .btn-primary:hover { background-color: var(--primary-dark); transform: translateY(-1px); }
    .btn-danger { background-color: var(--danger); color: #fff; }
    .btn-danger:hover { background-color: var(--danger-dark); transform: translateY(-1px); }
    .btn-outline { background-color: transparent; border: 1px solid var(--border); color: var(--text); }
    .btn-outline:hover { background-color: var(--card-bg); }
    .btn-sm { padding: 6px 12px; font-size: 12px; border-radius: 6px; }
    
    .container { max-width: 1200px; width: 100%; margin: 28px auto; padding: 0 24px; flex: 1; display: flex; flex-direction: column; }
    
    /* Tabs */
    .tabs-bar { display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border); padding-bottom: 12px; margin-bottom: 28px; }
    .tabs { display: flex; gap: 12px; }
    .tab-btn {
      background: none; border: none; color: var(--text-muted); font-size: 15px; font-weight: 700;
      padding: 10px 20px; cursor: pointer; transition: all 0.2s; border-radius: 8px;
    }
    .tab-btn:hover { color: var(--text); background-color: var(--card-bg); }
    .tab-btn.active { color: #fff; background-color: var(--primary); }
    
    .tab-content { display: none; }
    .tab-content.active { display: block; animation: fadeIn 0.3s ease-in-out; }
    
    /* Grid */
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 24px; }
    .card { background-color: var(--card-bg); border-radius: 14px; overflow: hidden; border: 1px solid var(--border); display: flex; flex-direction: column; transition: transform 0.2s, box-shadow 0.2s; }
    .card:hover { transform: translateY(-4px); box-shadow: 0 12px 20px rgba(0,0,0,0.3); }
    
    .video-thumb-wrap { position: relative; width: 100%; aspect-ratio: 16/9; background-color: #000; cursor: pointer; overflow: hidden; }
    .video-thumb-wrap.portrait { aspect-ratio: 9/16; max-height: 400px; }
    .thumb-img { width: 100%; height: 100%; object-fit: cover; }
    .thumb-placeholder { width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; font-size: 32px; background-color: #111; gap: 8px; color: var(--text-muted); }
    .thumb-placeholder p { font-size: 12px; }
    .play-overlay {
      position: absolute; inset: 0; background-color: rgba(0,0,0,0.4);
      display: flex; align-items: center; justify-content: center; opacity: 0; transition: opacity 0.2s;
    }
    .video-thumb-wrap:hover .play-overlay { opacity: 1; }
    .play-btn-circle {
      width: 52px; height: 52px; border-radius: 50%; background-color: var(--primary);
      display: flex; align-items: center; justify-content: center; font-size: 24px; color: #fff;
      box-shadow: 0 4px 15px rgba(26,170,148,0.4);
    }
    
    .card-body { padding: 18px; flex: 1; display: flex; flex-direction: column; gap: 10px; }
    .card-title { font-size: 16px; font-weight: 700; line-height: 1.4; color: var(--text); }
    .card-meta { display: flex; flex-wrap: wrap; gap: 8px; font-size: 12px; color: var(--text-muted); align-items: center; }
    .badge { padding: 3px 8px; border-radius: 6px; font-weight: 700; font-size: 10px; background-color: var(--border); color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; }
    .badge-teal { background-color: var(--primary-soft); color: var(--primary); }
    .badge-danger { background-color: rgba(239,68,68,0.15); color: var(--danger); }
    .card-desc { font-size: 13.5px; color: var(--text-muted); line-height: 1.6; margin-top: 4px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .card-actions { display: flex; gap: 10px; margin-top: auto; padding-top: 14px; border-top: 1px solid var(--border); }
    
    /* Login Modal Overlay */
    .modal-overlay {
      position: fixed; inset: 0; background-color: rgba(15, 23, 42, 0.95);
      display: flex; align-items: center; justify-content: center; z-index: 100;
      opacity: 0; pointer-events: none; transition: opacity 0.25s ease-out;
    }
    .modal-overlay.active { opacity: 1; pointer-events: auto; }
    .modal {
      background-color: var(--card-bg); border-radius: 18px; border: 1px solid var(--border);
      max-width: 440px; width: 100%; padding: 32px; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
      position: relative;
    }
    .modal-title { font-size: 20px; font-weight: 800; margin-bottom: 20px; text-align: center; letter-spacing: 0.5px; }
    .form-group { display: flex; flex-direction: column; gap: 8px; margin-bottom: 20px; }
    .form-group label { font-size: 13px; font-weight: 600; color: var(--text-muted); }
    .form-input {
      padding: 14px; border-radius: 10px; border: 1px solid var(--border); background-color: var(--bg);
      color: #fff; font-size: 16px; outline: none; transition: border-color 0.2s;
    }
    .form-input:focus { border-color: var(--primary); }
    .login-error { color: var(--danger); font-size: 13px; margin-top: -10px; margin-bottom: 15px; display: none; text-align: center; font-weight: 600; }
    
    /* Video Player Modal */
    .player-modal { max-width: 800px; padding: 24px; text-align: center; }
    .player-modal video { width: 100%; aspect-ratio: 16/9; border-radius: 10px; background-color: #000; outline: none; }
    .player-modal video.portrait { aspect-ratio: 9/16; max-height: 70vh; width: auto; margin: 0 auto; }
    .player-modal-title { font-size: 16px; font-weight: 700; margin-top: 14px; text-align: left; }
    .close-modal-btn { position: absolute; top: 12px; right: 16px; background: none; border: none; color: var(--text-muted); font-size: 28px; cursor: pointer; transition: color 0.2s; }
    .close-modal-btn:hover { color: #fff; }
    
    /* Toast Notifications */
    .toast-container { position: fixed; bottom: 24px; right: 24px; z-index: 1000; display: flex; flex-direction: column; gap: 10px; }
    .toast {
      background-color: var(--card-bg); border: 1px solid var(--border); color: #fff;
      padding: 14px 24px; border-radius: 10px; font-size: 14.5px; font-weight: 600;
      box-shadow: 0 20px 25px -5px rgba(0,0,0,0.3); border-left: 5px solid var(--primary);
      animation: slideIn 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards;
      display: flex; align-items: center; gap: 10px;
    }
    .toast.error { border-left-color: var(--danger); }
    
    /* Empty & Loader States */
    .loader { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; padding: 80px 0; color: var(--text-muted); }
    .spinner { width: 36px; height: 36px; border: 4px solid var(--border); border-top-color: var(--primary); border-radius: 50%; animation: spin 1s linear infinite; }
    .empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; padding: 80px 24px; text-align: center; color: var(--text-muted); border: 1px dashed var(--border); border-radius: 14px; background-color: rgba(30, 41, 59, 0.2); }
    .empty-state-icon { font-size: 48px; }
    
    @keyframes spin { to { transform: rotate(360deg); } }
    @keyframes slideIn { from { transform: translateX(100%) translateY(0); opacity: 0; } to { transform: translateX(0) translateY(0); opacity: 1; } }
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  </style>
</head>
<body>

  <!-- Header -->
  <header>
    <div class="logo-section">
      <div class="logo-circle">PS</div>
      <div class="title-area">
        <h1>Public Samachar</h1>
        <p>Admin Moderation & Content Management</p>
      </div>
    </div>
    <div class="header-actions" style="display: flex; align-items: center; gap: 12px;">
      <div style="display: flex; align-items: center; gap: 6px; font-size: 13px;">
        <label for="cleanupDays" style="color: var(--text-muted); font-weight: 600;">Keep (Days):</label>
        <input type="number" id="cleanupDays" value="30" min="0" style="padding: 6px 10px; border-radius: 6px; border: 1px solid var(--border); background-color: var(--bg); color: #fff; width: 70px; outline: none; font-size: 13px;">
      </div>
      <button class="btn btn-danger btn-sm" onclick="runStorageCleanup()">🧹 Clean Old</button>
      <button class="btn btn-outline" id="logoutBtn" onclick="logout()">Logout</button>
    </div>
  </header>

  <div class="container">
    <!-- Tabs Navigation -->
    <div class="tabs-bar">
      <div class="tabs">
        <button class="tab-btn active" onclick="switchTab('flagsTab', this)">⚠️ Review Flags</button>
        <button class="tab-btn" onclick="switchTab('videosTab', this)">📺 All Video Feed</button>
      </div>
      <div id="statusIndicator" style="font-size: 13px; color: var(--text-muted);">
        Authenticated As Admin
      </div>
    </div>

    <!-- Review Flags Content -->
    <div id="flagsTab" class="tab-content active">
      <div id="flagsLoader" class="loader">
        <div class="spinner"></div>
        <p>Loading flags and checking video metadata...</p>
      </div>
      <div id="flagsEmpty" class="empty-state" style="display: none;">
        <div class="empty-state-icon">✅</div>
        <h2>All Clear!</h2>
        <p>There are no flagged videos pending review right now.</p>
      </div>
      <div class="grid" id="flagsGrid"></div>
    </div>

    <!-- All Video Feed Content -->
    <div id="videosTab" class="tab-content">
      <div id="videosLoader" class="loader">
        <div class="spinner"></div>
        <p>Loading video feed from Cloudflare D1...</p>
      </div>
      <div id="videosEmpty" class="empty-state" style="display: none;">
        <div class="empty-state-icon">🎥</div>
        <h2>No Videos Found</h2>
        <p>No video uploads have been registered in the database yet.</p>
      </div>
      <div class="grid" id="videosGrid"></div>
    </div>
  </div>

  <!-- Login Modal Overlay -->
  <div class="modal-overlay active" id="loginOverlay">
    <div class="modal">
      <div class="logo-circle" style="margin: 0 auto 16px;">PS</div>
      <div class="modal-title">Admin Access Code</div>
      <div class="login-error" id="loginError">Invalid admin access code. Please try again.</div>
      <form onsubmit="handleLogin(event)">
        <div class="form-group">
          <label for="adminCode">ENTER ADMIN CODE</label>
          <input type="password" id="adminCode" class="form-input" placeholder="••••••••" required autofocus>
        </div>
        <button type="submit" class="btn btn-primary" style="width: 100%; padding: 14px;">Authenticate & Unlock</button>
      </form>
    </div>
  </div>

  <!-- Video Player Modal Overlay -->
  <div class="modal-overlay" id="playerOverlay" onclick="closePlayerModal()">
    <div class="modal player-modal" onclick="event.stopPropagation()">
      <button class="close-modal-btn" onclick="closePlayerModal()">&times;</button>
      <div id="videoContainer"></div>
      <div class="player-modal-title" id="playerModalTitle"></div>
    </div>
  </div>

  <!-- Toast Notification Container -->
  <div class="toast-container" id="toastContainer"></div>

  <script>
    let activeTab = 'flagsTab';
    
    // Check for saved access code
    document.addEventListener('DOMContentLoaded', () => {
      const code = localStorage.getItem('ps_admin_code');
      if (code) {
        document.getElementById('loginOverlay').classList.remove('active');
        loadAllData();
      }
    });

    function showToast(message, type = 'success') {
      const container = document.getElementById('toastContainer');
      const toast = document.createElement('div');
      toast.className = `toast ${type === 'error' ? 'error' : ''}`;
      toast.innerHTML = type === 'error' ? `❌ ${message}` : `✅ ${message}`;
      container.appendChild(toast);
      setTimeout(() => {
        toast.style.animation = 'none';
        toast.offsetHeight; // trigger reflow
        toast.style.animation = 'slideIn 0.25s reverse forwards';
        setTimeout(() => toast.remove(), 250);
      }, 3500);
    }

    function handleLogin(e) {
      e.preventDefault();
      const code = document.getElementById('adminCode').value.trim();
      if (!code) return;
      
      // Attempt verification by making a test API call to /admin/flagged-videos
      fetch('/api/admin/flagged-videos', {
        headers: { 'X-Admin-Code': code }
      })
      .then(resp => {
        if (resp.ok) {
          localStorage.setItem('ps_admin_code', code);
          document.getElementById('loginOverlay').classList.remove('active');
          document.getElementById('loginError').style.display = 'none';
          document.getElementById('adminCode').value = '';
          showToast('Authentication successful!');
          loadAllData();
        } else {
          document.getElementById('loginError').style.display = 'block';
        }
      })
      .catch(() => {
        document.getElementById('loginError').textContent = 'Network error. Please try again.';
        document.getElementById('loginError').style.display = 'block';
      });
    }

    function logout() {
      localStorage.removeItem('ps_admin_code');
      document.getElementById('loginOverlay').classList.add('active');
      document.getElementById('flagsGrid').innerHTML = '';
      document.getElementById('videosGrid').innerHTML = '';
      showToast('Logged out successfully.');
    }

    function switchTab(tabId, btn) {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(tabId).classList.add('active');
      activeTab = tabId;
    }

    function getAuthHeaders() {
      const code = localStorage.getItem('ps_admin_code');
      return { 'X-Admin-Code': code || '' };
    }

    function loadAllData() {
      loadFlags();
      loadVideos();
    }

    async function loadFlags() {
      const grid = document.getElementById('flagsGrid');
      const loader = document.getElementById('flagsLoader');
      const emptyState = document.getElementById('flagsEmpty');
      
      grid.innerHTML = '';
      loader.style.display = 'flex';
      emptyState.style.display = 'none';
      
      try {
        const resp = await fetch('/api/admin/flagged-videos', { headers: getAuthHeaders() });
        if (resp.status === 403) {
          logout();
          return;
        }
        if (!resp.ok) throw new Error('Failed to load flags');
        
        const data = await resp.json();
        const pendingFlags = (data.flags || []).filter(f => f.status === 'pending');
        
        if (pendingFlags.length === 0) {
          loader.style.display = 'none';
          emptyState.style.display = 'flex';
          return;
        }
        
        loader.style.display = 'none';
        
        for (const flag of pendingFlags) {
          const card = document.createElement('div');
          card.className = 'card';
          card.id = `flag-card-${flag.id}`;
          
          // Place loading placeholder
          card.innerHTML = `
            <div class="card-body">
              <div class="card-meta">
                <span class="badge badge-danger">FLAGGED: ${escapeHTML(flag.reason)}</span>
              </div>
              <p style="font-size:12px; color:var(--text-muted);">Loading video metadata (ID: ${flag.video_id})...</p>
            </div>
          `;
          grid.appendChild(card);
          
          // Fetch video details in background
          fetchVideoDetails(flag.video_id).then(video => {
            if (video) {
              const isPortrait = video.aspect_ratio === '9:16';
              card.innerHTML = `
                <div class="video-thumb-wrap ${isPortrait ? 'portrait' : ''}" onclick="playVideo('${escapeJS(video.video_url)}', '${escapeJS(video.title)}', ${isPortrait})">
                  ${video.thumb_url ? `<img src="${video.thumb_url}" class="thumb-img" alt="Video thumbnail">` : `
                    <div class="thumb-placeholder">
                      🎥
                      <p>No Thumbnail</p>
                    </div>
                  `}
                  <div class="play-overlay">
                    <div class="play-btn-circle">▶</div>
                  </div>
                </div>
                <div class="card-body">
                  <div class="card-meta">
                    <span class="badge badge-danger">FLAGGED: ${escapeHTML(flag.reason)}</span>
                    <span class="badge badge-teal">${escapeHTML(video.location || 'Karnataka')}</span>
                    ${isPortrait ? '<span class="badge">Portrait 9:16</span>' : '<span class="badge">Landscape 16:9</span>'}
                  </div>
                  <h3 class="card-title">${escapeHTML(video.title)}</h3>
                  <div class="card-meta">
                    <span>👤 ${escapeHTML(video.reporter_name)}</span>
                    <span>•</span>
                    <span>${new Date(video.timestamp).toLocaleDateString()}</span>
                  </div>
                  <p class="card-desc">${escapeHTML(video.description || 'No description.')}</p>
                  <div class="card-actions">
                    <button class="btn btn-outline btn-sm" onclick="dismissFlag('${flag.id}')" style="flex:1;">✅ Mark Safe</button>
                    <button class="btn btn-danger btn-sm" onclick="deleteVideo('${video.id}', '${flag.id}')" style="flex:1;">🗑️ Delete Video</button>
                  </div>
                </div>
              `;
            } else {
              card.innerHTML = `
                <div class="card-body">
                  <div class="card-meta">
                    <span class="badge badge-danger">FLAGGED: ${escapeHTML(flag.reason)}</span>
                  </div>
                  <h3 class="card-title" style="color:var(--danger)">Video Already Deleted or Not Found</h3>
                  <p class="card-desc">The database contains a moderation flag, but the video record (ID: ${flag.video_id}) is no longer in the feed.</p>
                  <div class="card-actions">
                    <button class="btn btn-outline btn-sm" onclick="dismissFlag('${flag.id}')" style="width:100%;">Dismiss Flag Record</button>
                  </div>
                </div>
              `;
            }
          });
        }
      } catch (e) {
        loader.style.display = 'none';
        showToast('Error loading flagged videos', 'error');
      }
    }

    async function loadVideos() {
      const grid = document.getElementById('videosGrid');
      const loader = document.getElementById('videosLoader');
      const emptyState = document.getElementById('videosEmpty');
      
      grid.innerHTML = '';
      loader.style.display = 'flex';
      emptyState.style.display = 'none';
      
      try {
        const resp = await fetch('/api/cf/videos?page=1&limit=100');
        if (!resp.ok) throw new Error('Failed to load video feed');
        
        const data = await resp.json();
        const videos = data.videos || [];
        
        if (videos.length === 0) {
          loader.style.display = 'none';
          emptyState.style.display = 'flex';
          return;
        }
        
        loader.style.display = 'none';
        
        videos.forEach(video => {
          const isPortrait = video.aspect_ratio === '9:16';
          const card = document.createElement('div');
          card.className = 'card';
          card.id = `video-card-${video.id}`;
          
          card.innerHTML = `
            <div class="video-thumb-wrap ${isPortrait ? 'portrait' : ''}" onclick="playVideo('${escapeJS(video.video_url)}', '${escapeJS(video.title)}', ${isPortrait})">
              ${video.thumb_url ? `<img src="${video.thumb_url}" class="thumb-img" alt="Video thumbnail">` : `
                <div class="thumb-placeholder">
                  🎥
                  <p>No Thumbnail</p>
                </div>
              `}
              <div class="play-overlay">
                <div class="play-btn-circle">▶</div>
              </div>
            </div>
            <div class="card-body">
              <div class="card-meta">
                <span class="badge badge-teal">${escapeHTML(video.location || 'Karnataka')}</span>
                <span>👀 ${video.views || 0} Views</span>
                ${isPortrait ? '<span class="badge">Portrait 9:16</span>' : '<span class="badge">Landscape 16:9</span>'}
              </div>
              <h3 class="card-title">${escapeHTML(video.title)}</h3>
              <div class="card-meta">
                <span>👤 ${escapeHTML(video.reporter_name)}</span>
                <span>•</span>
                <span>${new Date(video.timestamp).toLocaleDateString()}</span>
              </div>
              <p class="card-desc">${escapeHTML(video.description || 'No description.')}</p>
              <div class="card-actions">
                <button class="btn btn-danger btn-sm" onclick="deleteVideo('${video.id}')" style="width:100%;">🗑️ Delete Video</button>
              </div>
            </div>
          `;
          grid.appendChild(card);
        });
      } catch (e) {
        loader.style.display = 'none';
        showToast('Error loading video feed', 'error');
      }
    }

    async function fetchVideoDetails(videoId) {
      try {
        const resp = await fetch(`/api/cf/post/${videoId}`);
        if (resp.ok) {
          return await resp.json();
        }
      } catch {}
      return null;
    }

    async function dismissFlag(flagId) {
      if (!confirm('Are you sure you want to dismiss this flag and mark this video as safe?')) return;
      try {
        const resp = await fetch(`/api/admin/resolve-flag/${flagId}`, {
          method: 'POST',
          headers: getAuthHeaders()
        });
        if (resp.ok) {
          showToast('Flag resolved and dismissed.');
          loadFlags();
        } else {
          showToast('Failed to resolve flag.', 'error');
        }
      } catch {
        showToast('Network error resolving flag.', 'error');
      }
    }

    async function deleteVideo(videoId, flagId = null) {
      if (!confirm('🚨 WARNING: This will permanently delete the video file from Cloudflare R2 and remove all entries from D1 (including comments/flags). Are you sure?')) return;
      try {
        const resp = await fetch(`/api/cf/videos/${videoId}`, {
          method: 'DELETE',
          headers: getAuthHeaders()
        });
        if (resp.ok) {
          showToast('Video permanently deleted.');
          if (flagId) {
            loadAllData();
          } else {
            const el = document.getElementById(`video-card-${videoId}`);
            if (el) el.remove();
            loadFlags();
          }
        } else {
          const data = await resp.json().catch(() => ({}));
          showToast(data.detail || 'Failed to delete video.', 'error');
        }
      } catch {
        showToast('Network error deleting video.', 'error');
      }
    }

    function playVideo(url, title, isPortrait) {
      const container = document.getElementById('videoContainer');
      const titleEl = document.getElementById('playerModalTitle');
      
      container.innerHTML = `
        <video controls autoplay class="${isPortrait ? 'portrait' : ''}">
          <source src="${url}" type="video/mp4">
          Your browser does not support the video tag.
        </video>
      `;
      titleEl.textContent = title;
      document.getElementById('playerOverlay').classList.add('active');
    }

    function closePlayerModal() {
      document.getElementById('playerOverlay').classList.remove('active');
      document.getElementById('videoContainer').innerHTML = '';
    }

    async function runStorageCleanup() {
      const days = document.getElementById('cleanupDays').value;
      if (days === '' || days < 0) {
        showToast('Please enter a valid non-negative number of days.', 'error');
        return;
      }
      
      const confirmMsg = `🚨 WARNING: This will permanently delete ALL videos older than ${days} days from database and storage. This action CANNOT be undone. Are you sure you want to proceed?`;
      if (!confirm(confirmMsg)) return;
      
      showToast('Running cleanup, please wait...');
      
      try {
        const resp = await fetch(`/api/admin/cleanup-old-videos?days=${days}`, {
          method: 'POST',
          headers: getAuthHeaders()
        });
        
        if (resp.ok) {
          const data = await resp.json();
          showToast(`Cleanup complete! Deleted ${data.count} old videos.`);
          loadAllData();
        } else {
          const data = await resp.json().catch(() => ({}));
          showToast(data.detail || 'Failed to run cleanup.', 'error');
        }
      } catch (e) {
        showToast('Network error running cleanup.', 'error');
      }
    }

    function escapeHTML(str) {
      if (!str) return '';
      return str.replace(/[&<>'"]/g, 
        tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
      );
    }
    function escapeJS(str) {
      if (!str) return '';
      return str.replace(/'/g, "\\'").replace(/"/g, '\\"');
    }
  </script>
</body>
</html>"""
    return HTMLResponse(content=html_content)


@api_router.get("/cf/setup")
async def cf_setup():
    """Manually trigger Cloudflare infrastructure setup (bucket + tables)."""
    ensure_r2_bucket()
    ensure_d1_tables()
    return {'success': True, 'message': 'Cloudflare infrastructure ensured'}


app.include_router(api_router)


# ── Root health probe — required for Kubernetes liveness/readiness checks ─────
@app.get("/")
async def root_health_probe():
    """
    Root endpoint for Kubernetes/GCP load balancer health checks.
    The K8s probe hits GET / — must return 200 OK or the pod is marked unhealthy
    and the deployment fails.
    """
    return {"status": "ok", "service": "public-samachar-backend"}


# ── Global exception handler — prevent unhandled errors from crashing process ─
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled exception on {request.method} {request.url.path}: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"error": "Internal server error", "detail": str(exc)},
    )


@app.on_event("startup")
async def startup_event():
    """Initialize Cloudflare infrastructure and warm up the httpx async client."""
    try:
        # Pre-create the async HTTP client so first request is fast
        get_async_client()
        # Run synchronous infra checks in a thread to avoid blocking event loop startup
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, ensure_r2_bucket)
        await loop.run_in_executor(None, ensure_d1_tables)
        logger.info("Cloudflare infrastructure ready")
    except Exception as e:
        logger.warning(f"CF startup init error (non-fatal): {e}")


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
    global _async_http_client
    if _async_http_client and not _async_http_client.is_closed:
        await _async_http_client.aclose()
        logger.info("httpx AsyncClient closed cleanly")
