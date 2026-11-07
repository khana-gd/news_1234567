#!/usr/bin/env python3
import os
import sys
import argparse
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')
load_dotenv(ROOT_DIR.parent / '.env')

# Re-import variables/helpers from server.py to use same credentials and logic
try:
    from server import (
        CF_ACCOUNT_ID,
        CF_API_TOKEN,
        D1_DB_ID,
        R2_BUCKET_NAME,
        d1_query,
        get_r2_s3_client,
    )
except ImportError:
    # If server.py is not in PYTHONPATH, add it
    sys.path.append(str(ROOT_DIR))
    from server import (
        CF_ACCOUNT_ID,
        CF_API_TOKEN,
        D1_DB_ID,
        R2_BUCKET_NAME,
        d1_query,
        get_r2_s3_client,
    )

# ANSI Colors
GREEN = "\033[92m"
RED = "\033[91m"
YELLOW = "\033[93m"
CYAN = "\033[96m"
BOLD = "\033[1m"
RESET = "\033[0m"

def main():
    parser = argparse.ArgumentParser(description="Delete a video from Cloudflare D1 database and R2 bucket.")
    parser.add_argument("video_id", help="The ID of the video to delete (e.g. 'video_1721669485000')")
    parser.add_argument("--dry-run", action="store_true", help="Perform a dry run without deleting files or DB rows")
    args = parser.parse_args()

    video_id = args.video_id.strip()
    if not video_id:
        print(f"{RED}Error: Please specify a valid Video ID.{RESET}")
        sys.exit(1)

    # Clean prefix 'cf_' if passed from app side
    clean_id = video_id
    if clean_id.startswith("cf_"):
        clean_id = clean_id[3:]

    print(f"\n{BOLD}=== Deleting Video: {CYAN}{clean_id}{RESET} ===\n")

    # 1. Fetch metadata from D1 first to get R2 keys
    print("Checking video status in D1 database...")
    results = d1_query("SELECT * FROM news_feed WHERE id = ?", [clean_id])
    if not results:
        # Try with original ID just in case
        results = d1_query("SELECT * FROM news_feed WHERE id = ?", [video_id])
        if results:
            clean_id = video_id
        else:
            print(f"{YELLOW}Warning: Video with ID '{clean_id}' was not found in the D1 news_feed table.{RESET}")
            confirm = input("Would you like to try deleting files from R2 anyway? (y/N): ").strip().lower()
            if confirm != 'y':
                print("Aborted.")
                sys.exit(1)
            v_meta = {}
    else:
        v_meta = results[0]
        print(f"Found Video: {BOLD}{v_meta.get('title')}{RESET}")
        print(f"Reporter: {v_meta.get('reporter_name')} (ID: {v_meta.get('reporter_id')})")
        print(f"Timestamp: {v_meta.get('timestamp')}")

    # Determine R2 keys
    video_key = v_meta.get("video_url")
    thumb_key = v_meta.get("thumb_url")

    # If keys are full URLs, extract the path/key relative to R2 bucket
    # Standard format is: news_feed/videos/{id}.mp4 and news_feed/thumbs/{id}.jpg
    if not video_key:
        video_key = f"news_feed/videos/{clean_id}.mp4"
    elif "/" in video_key and video_key.startswith("http"):
        # Extract R2 key from public CDN URL
        video_key = video_key.split(".dev/")[-1].split(".com/")[-1]

    if not thumb_key:
        thumb_key = f"news_feed/thumbs/{clean_id}.jpg"
    elif "/" in thumb_key and thumb_key.startswith("http"):
        thumb_key = thumb_key.split(".dev/")[-1].split(".com/")[-1]

    print(f"Target Video Key: {CYAN}{video_key}{RESET}")
    print(f"Target Thumb Key: {CYAN}{thumb_key}{RESET}")

    # Confirm action
    if not args.dry_run:
        confirm = input(f"\n{RED}{BOLD}WARNING: This will permanently delete the video and its database entries. Confirm? (y/N): {RESET}").strip().lower()
        if confirm != 'y':
            print("Cancellation requested. Exiting.")
            sys.exit(0)

    # 2. Delete from Cloudflare R2 bucket
    print("\n--- Deleting files from Cloudflare R2 ---")
    if not CF_ACCOUNT_ID or not CF_API_TOKEN:
        print(f"{YELLOW}Warning: Cloudflare credentials are missing. Skipping R2 file deletion.{RESET}")
    else:
        try:
            s3 = get_r2_s3_client()
            if args.dry_run:
                print(f"[DRY-RUN] Would delete R2 video: {video_key}")
                print(f"[DRY-RUN] Would delete R2 thumbnail: {thumb_key}")
            else:
                # Delete video
                print(f"Deleting R2 Video file '{video_key}'...")
                s3.delete_object(Bucket=R2_BUCKET_NAME, Key=video_key)
                print(f"{GREEN}[OK] Video deleted from R2.{RESET}")

                # Delete thumbnail
                if thumb_key:
                    print(f"Deleting R2 Thumbnail file '{thumb_key}'...")
                    s3.delete_object(Bucket=R2_BUCKET_NAME, Key=thumb_key)
                    print(f"{GREEN}[OK] Thumbnail deleted from R2.{RESET}")
        except Exception as e:
            print(f"{RED}[FAIL] Failed to delete from Cloudflare R2: {e}{RESET}")

    # 3. Delete from D1 Database (news_feed, comments, flags)
    print("\n--- Deleting records from Cloudflare D1 ---")
    if not D1_DB_ID:
        print(f"{YELLOW}Warning: D1 Database ID is missing. Skipping database entries deletion.{RESET}")
    else:
        try:
            if args.dry_run:
                print(f"[DRY-RUN] Would execute: DELETE FROM news_feed WHERE id = '{clean_id}'")
                print(f"[DRY-RUN] Would execute: DELETE FROM ps_comments WHERE video_id = '{clean_id}'")
                print(f"[DRY-RUN] Would execute: DELETE FROM flagged_videos WHERE video_id = '{clean_id}'")
            else:
                # Delete news feed entry
                print("Deleting video metadata from news_feed...")
                d1_query("DELETE FROM news_feed WHERE id = ?", [clean_id])
                print(f"{GREEN}[OK] Deleted news_feed entry.{RESET}")

                # Delete associated comments
                print("Deleting associated comments from ps_comments...")
                d1_query("DELETE FROM ps_comments WHERE video_id = ?", [clean_id])
                print(f"{GREEN}[OK] Deleted associated comments.{RESET}")

                # Delete associated moderation flags
                print("Deleting associated flags from flagged_videos...")
                d1_query("DELETE FROM flagged_videos WHERE video_id = ?", [clean_id])
                print(f"{GREEN}[OK] Deleted associated flags.{RESET}")
        except Exception as e:
            print(f"{RED}[FAIL] Failed to delete records from Cloudflare D1: {e}{RESET}")

    print(f"\n{GREEN}{BOLD}Deletion task finished.{RESET}\n")

if __name__ == "__main__":
    main()
