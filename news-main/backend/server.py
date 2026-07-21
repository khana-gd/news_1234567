from fastapi import FastAPI, APIRouter, status
from fastapi.responses import JSONResponse, HTMLResponse
import html
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import asyncio
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List
import uuid
from datetime import datetime


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Create the main app without a prefix
app = FastAPI()

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")


# Define Models
class StatusCheck(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    client_name: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)

class StatusCheckCreate(BaseModel):
    client_name: str

# Add your routes to the router instead of directly to app
@api_router.get("/")
async def root():
    return {"message": "Hello World"}

@api_router.post("/status", response_model=StatusCheck)
async def create_status_check(input: StatusCheckCreate):
    status_dict = input.dict()
    status_obj = StatusCheck(**status_dict)
    _ = await db.status_checks.insert_one(status_obj.dict())
    return status_obj

@api_router.get("/status", response_model=List[StatusCheck])
async def get_status_checks():
    status_checks = await db.status_checks.find().to_list(1000)
    return [StatusCheck(**status_check) for status_check in status_checks]

import urllib.request
import json
import re

def fetch_wp_post_sync(wp_id: str):
    try:
        url = f"https://mypublicsamachar.com/wp-json/wp/v2/posts/{wp_id}?_embed=1"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
        with urllib.request.urlopen(req, timeout=3.5) as resp:
            data = json.loads(resp.read().decode("utf-8", errors="ignore"))
            t = html.unescape(data.get("title", {}).get("rendered", ""))
            c = data.get("content", {}).get("rendered", "") or data.get("excerpt", {}).get("rendered", "")
            img = data.get("jetpack_featured_media_url", "")
            if not img and "_embedded" in data:
                media = data["_embedded"].get("wp:featuredmedia", [])
                if media and isinstance(media, list) and len(media) > 0:
                    img = media[0].get("source_url", "")
            auth = ""
            if "_embedded" in data:
                authors = data["_embedded"].get("author", [])
                if authors and isinstance(authors, list) and len(authors) > 0:
                    auth = authors[0].get("name", "")
            return t, c, img, auth
    except Exception as e:
        logger.error(f"Error fetching WP post {wp_id}: {e}")
        return "", "", "", ""

def fetch_yt_oembed_sync(yt_id: str):
    try:
        url = f"https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v={yt_id}&format=json"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
        with urllib.request.urlopen(req, timeout=3.5) as resp:
            data = json.loads(resp.read().decode("utf-8", errors="ignore"))
            t = html.unescape(data.get("title", ""))
            auth = data.get("author_name", "Public Samachar")
            img = f"https://img.youtube.com/vi/{yt_id}/hqdefault.jpg"
            src = f"https://www.youtube.com/embed/{yt_id}"
            return t, f"Watch '{t}' on My Public Samachar.", img, auth, src
    except Exception as e:
        logger.error(f"Error fetching YT oembed {yt_id}: {e}")
        return "", "", "", "", ""


@api_router.get("/cf/share/{video_id}", response_class=HTMLResponse)
@api_router.get("/og/{video_id}", response_class=HTMLResponse)
async def share_video_page(video_id: str):
    video = None
    title = ""
    description = ""
    video_url = ""
    thumb_url = ""
    reporter_name = ""
    location = ""

    clean_id = video_id.replace("yt_", "").strip()

    # 1. Search MongoDB
    try:
        collections = await db.list_collection_names()
        id_queries = [
            {"id": video_id},
            {"_id": video_id},
            {"video_id": video_id},
            {"cf_id": video_id},
            {"id": clean_id},
            {"_id": clean_id}
        ]
        if video_id.isdigit():
            id_queries.extend([{"id": int(video_id)}, {"_id": int(video_id)}])
        elif clean_id.isdigit():
            id_queries.extend([{"id": int(clean_id)}, {"_id": int(clean_id)}])

        search_query = {"$or": id_queries}
        priority_cols = ["cf_videos", "videos", "posts", "news_feed", "news", "articles"]
        for col_name in priority_cols:
            if col_name in collections:
                video = await db[col_name].find_one(search_query)
                if video:
                    break

        if not video:
            for col_name in collections:
                if col_name not in priority_cols and not col_name.startswith("system."):
                    video = await db[col_name].find_one(search_query)
                    if video:
                        break
    except Exception as e:
        logger.error(f"Error fetching video {video_id} from MongoDB: {e}")

    if video:
        title = video.get("title") or video.get("name") or video.get("caption") or video.get("headline") or video.get("post_title") or ""
        description = video.get("description") or video.get("content") or video.get("summary") or video.get("body") or video.get("text") or video.get("post_content") or ""
        video_url = video.get("video_url") or video.get("videoUrl") or video.get("url") or video.get("src") or ""
        thumb_url = video.get("thumb_url") or video.get("thumbUrl") or video.get("thumbnail") or video.get("poster") or video.get("image") or ""
        reporter_name = video.get("reporter_name") or video.get("reporterName") or video.get("author") or video.get("reporter") or video.get("user") or ""
        location = video.get("location") or video.get("place") or video.get("district") or video.get("city") or ""

    # 2. If not found in MongoDB and ID is numeric, fetch from WordPress REST API
    if not title and (video_id.isdigit() or clean_id.isdigit()):
        wp_id = video_id if video_id.isdigit() else clean_id
        t, c, img, auth = await asyncio.to_thread(fetch_wp_post_sync, wp_id)
        if t:
            title = t
            description = c
            if img:
                thumb_url = img
            if auth:
                reporter_name = auth

            mp4_match = re.search(r'src=["\'](https?://[^"\']+\.mp4)["\']', c, re.IGNORECASE)
            if mp4_match:
                video_url = mp4_match.group(1)
            else:
                iframe_match = re.search(r'src=["\'](https?://[^"\']+)["\']', c, re.IGNORECASE)
                if iframe_match:
                    video_url = iframe_match.group(1)

    # 3. If not found and YouTube ID
    if not title and (video_id.startswith("yt_") or len(clean_id) == 11):
        t, c, img, auth, src = await asyncio.to_thread(fetch_yt_oembed_sync, clean_id)
        if t:
            title = t
            description = c
            thumb_url = img
            reporter_name = auth
            video_url = src

    if not title:
        title = "My Public Samachar - Local Video News"
    if not description:
        description = "Watch local video news from Karnataka on My Public Samachar."
    if not reporter_name:
        reporter_name = "Public Samachar"
    if not location:
        location = "Karnataka"

    safe_title = html.escape(str(title))
    plain_desc = re.sub(r'<[^>]+>', '', str(description))
    safe_desc = html.escape(str(plain_desc))
    safe_reporter = html.escape(str(reporter_name))
    safe_location = html.escape(str(location))
    safe_video_url = html.escape(str(video_url))
    safe_thumb_url = html.escape(str(thumb_url))

    if "<p" in str(description) or "<div" in str(description) or "<br" in str(description):
        clean_body = re.sub(r'<script.*?>.*?</script>', '', str(description), flags=re.DOTALL | re.IGNORECASE)
        clean_body = re.sub(r'<style.*?>.*?</style>', '', clean_body, flags=re.DOTALL | re.IGNORECASE)
        rendered_body = clean_body
    else:
        paragraphs = [p.strip() for p in str(description).split("\n") if p.strip()]
        if not paragraphs:
            paragraphs = [safe_desc]
        rendered_body = "".join(f"<p class='content-paragraph'>{html.escape(p)}</p>" for p in paragraphs)

    html_content = f"""<!DOCTYPE html>
<html lang="kn">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{safe_title} - Public Samachar</title>
    
    <!-- OpenGraph & Twitter Meta Tags -->
    <meta property="og:type" content="video.other">
    <meta property="og:title" content="{safe_title}">
    <meta property="og:description" content="{safe_desc}">
    <meta property="og:image" content="{safe_thumb_url}">
    <meta property="og:video" content="{safe_video_url}">
    <meta property="og:site_name" content="Public Samachar">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="{safe_title}">
    <meta name="twitter:description" content="{safe_desc}">
    <meta name="twitter:image" content="{safe_thumb_url}">

    <!-- Fonts & Styling -->
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Noto+Sans+Kannada:wght@400;500;600;700&display=swap" rel="stylesheet">
    
    <style>
        * {{
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }}
        body {{
            font-family: 'Noto Sans Kannada', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
            background-color: #f8fafc;
            color: #0f172a;
            line-height: 1.7;
            -webkit-font-smoothing: antialiased;
        }}
        header {{
            background: linear-gradient(135deg, #1AAA94 0%, #0D8975 100%);
            color: #ffffff;
            padding: 16px 20px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }}
        .header-container {{
            max-width: 680px;
            margin: 0 auto;
            display: flex;
            align-items: center;
            gap: 12px;
        }}
        .brand-logo {{
            width: 42px;
            height: 42px;
            border-radius: 10px;
            background-color: #ffffff;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: 800;
            font-size: 18px;
            color: #1AAA94;
            box-shadow: 0 2px 4px rgba(0,0,0,0.15);
        }}
        .brand-title {{
            font-size: 20px;
            font-weight: 700;
            letter-spacing: -0.3px;
        }}
        .brand-subtitle {{
            font-size: 12px;
            opacity: 0.9;
            font-weight: 400;
        }}
        main {{
            max-width: 680px;
            margin: 20px auto;
            padding: 0 16px 40px;
        }}
        .video-container {{
            width: 100%;
            background-color: #000000;
            border-radius: 16px;
            overflow: hidden;
            box-shadow: 0 4px 20px rgba(0,0,0,0.08);
            margin-bottom: 20px;
            aspect-ratio: 16 / 9;
            position: relative;
        }}
        video {{
            width: 100%;
            height: 100%;
            display: block;
            object-fit: contain;
        }}
        .article-card {{
            background-color: #ffffff;
            border-radius: 16px;
            padding: 24px;
            box-shadow: 0 2px 12px rgba(0,0,0,0.05);
            border: 1px solid #e2e8f0;
            margin-bottom: 24px;
        }}
        .article-title {{
            font-size: 22px;
            font-weight: 700;
            color: #0f172a;
            line-height: 1.4;
            margin-bottom: 14px;
        }}
        .meta-row {{
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 10px;
            margin-bottom: 20px;
            padding-bottom: 16px;
            border-bottom: 1px solid #f1f5f9;
        }}
        .badge {{
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 6px 12px;
            border-radius: 20px;
            font-size: 13px;
            font-weight: 600;
        }}
        .badge-reporter {{
            background-color: #f1f5f9;
            color: #334155;
        }}
        .badge-location {{
            background-color: #e6f7f3;
            color: #0d8975;
        }}
        .content-paragraph {{
            font-size: 16px;
            color: #334155;
            line-height: 1.8;
            margin-bottom: 16px;
            word-break: break-word;
        }}
        .content-paragraph:last-child {{
            margin-bottom: 0;
        }}
        .action-buttons {{
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 12px;
            margin-top: 24px;
        }}
        @media (max-width: 480px) {{
            .action-buttons {{
                grid-template-columns: 1fr;
            }}
        }}
        .btn {{
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            padding: 14px 20px;
            border-radius: 30px;
            font-size: 15px;
            font-weight: 700;
            text-decoration: none;
            transition: transform 0.15s ease, opacity 0.15s ease;
            box-shadow: 0 2px 6px rgba(0,0,0,0.1);
        }}
        .btn:active {{
            transform: scale(0.98);
        }}
        .btn-whatsapp {{
            background-color: #25D366;
            color: #ffffff;
        }}
        .btn-download {{
            background-color: #1AAA94;
            color: #ffffff;
        }}
        footer {{
            text-align: center;
            font-size: 13px;
            color: #64748b;
            margin-top: 24px;
        }}
        footer a {{
            color: #1AAA94;
            text-decoration: none;
            font-weight: 600;
        }}
    </style>
</head>
<body>

    <header>
        <div class="header-container">
            <div class="brand-logo">PS</div>
            <div>
                <div class="brand-title">Public Samachar</div>
                <div class="brand-subtitle">Your Local Video News</div>
            </div>
        </div>
    </header>

    <main>
        {"<div class='video-container'><video controls poster='" + safe_thumb_url + "' preload='metadata' playsinline src='" + safe_video_url + "'></video></div>" if safe_video_url else ""}

        <article class="article-card">
            <h1 class="article-title">{safe_title}</h1>
            
            <div class="meta-row">
                <span class="badge badge-reporter">👤 {safe_reporter}</span>
                <span class="badge badge-location">📍 {safe_location}</span>
            </div>

            <div class="article-body">
                {rendered_body}
            </div>

            <div class="action-buttons">
                <a href="https://api.whatsapp.com/send?text={safe_title}%20{html.escape(safe_video_url)}" class="btn btn-whatsapp" target="_blank" rel="noopener">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981z"/></svg>
                    Share on WhatsApp
                </a>
                <a href="https://play.google.com/store/apps/details?id=com.sudhu1234.publicsamacharmobile" class="btn btn-download" target="_blank" rel="noopener">
                    📲 Download App
                </a>
            </div>
        </article>

        <footer>
            Public Samachar · Your local news, your language<br>
            <a href="https://play.google.com/store/apps/details?id=com.sudhu1234.publicsamacharmobile">Download the free app</a>
        </footer>
    </main>

</body>
</html>"""
    return HTMLResponse(content=html_content, status_code=200)


@api_router.get("/health")
async def health_check():
    health_status = {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "services": {
            "mongodb": {
                "status": "unknown"
            }
        }
    }
    
    try:
        # Ping MongoDB using admin ping command with a 2-second timeout
        await asyncio.wait_for(client.admin.command('ping'), timeout=2.0)
        health_status["services"]["mongodb"]["status"] = "connected"
    except Exception as e:
        health_status["status"] = "unhealthy"
        health_status["services"]["mongodb"]["status"] = "disconnected"
        health_status["services"]["mongodb"]["error"] = str(e)
        
    if health_status["status"] == "unhealthy":
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content=health_status
        )
    return health_status

# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
