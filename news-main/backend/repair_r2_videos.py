import os
import sys
import subprocess
import tempfile
import boto3
import dotenv
from pathlib import Path

backend_dir = Path(__file__).parent
dotenv.load_dotenv(backend_dir / '.env')
sys.path.insert(0, str(backend_dir))
import server

cf_account_id = os.environ.get('CF_ACCOUNT_ID', '')
r2_access_key = os.environ.get('R2_ACCESS_KEY_ID', '')
r2_secret_key = os.environ.get('R2_SECRET_ACCESS_KEY', '')
r2_bucket = os.environ.get('R2_BUCKET_NAME', 'public-samachar-videos')

s3 = boto3.client(
    's3',
    endpoint_url=f'https://{cf_account_id}.r2.cloudflarestorage.com',
    aws_access_key_id=r2_access_key,
    aws_secret_access_key=r2_secret_key,
    region_name='auto'
)

temp_dir = Path(tempfile.gettempdir()) / 'ps_video_repair'
temp_dir.mkdir(parents=True, exist_ok=True)

vids = server.d1_query('SELECT id, title, video_url, timestamp FROM news_feed ORDER BY timestamp DESC LIMIT 8')
print(f"Found {len(vids)} recent videos to check in D1:")

for v in vids:
    vid_id = v['id']
    key = v['video_url']
    if not key:
        continue
    if key.startswith('http'):
        key = key.split('.r2.dev/')[-1]
    
    print(f"\nChecking video: {vid_id} (key: {key})")
    raw_path = temp_dir / f"{vid_id}_raw.mp4"
    fixed_path = temp_dir / f"{vid_id}_fixed.mp4"
    
    try:
        s3.download_file(r2_bucket, key, str(raw_path))
        raw_size = raw_path.stat().st_size
        print(f"  Downloaded {raw_size / 1024 / 1024:.2f} MB")
        
        # Probe streams
        probe_cmd = [
            "ffprobe", "-v", "error",
            "-show_entries", "stream=index,codec_type,duration,nb_frames,r_frame_rate",
            "-of", "json",
            str(raw_path)
        ]
        res = subprocess.run(probe_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        import json
        info = json.loads(res.stdout)
        streams = info.get('streams', [])
        
        v_stream = next((s for s in streams if s.get('codec_type') == 'video'), None)
        a_stream = next((s for s in streams if s.get('codec_type') == 'audio'), None)
        
        v_dur = float(v_stream.get('duration') or 0) if v_stream else 0
        a_dur = float(a_stream.get('duration') or 0) if a_stream else 0
        v_frames = int(v_stream.get('nb_frames') or 0) if v_stream else 0
        
        print(f"  Video duration: {v_dur:.2f}s (frames: {v_frames}), Audio duration: {a_dur:.2f}s")
        
        needs_fix = False
        if abs(v_dur - a_dur) > 1.0:
            print(f"  ⚠️ OUT OF SYNC! Discrepancy: {abs(v_dur - a_dur):.2f}s")
            needs_fix = True
        elif v_frames > 0 and v_dur > 0 and (v_frames / v_dur) < 20:
            print(f"  ⚠️ LOW FPS! ({v_frames / v_dur:.1f} fps)")
            needs_fix = True
            
        if needs_fix or True: # Transcode all top recent to ensure absolute 30fps CFR + faststart + 2.2Mbps maxrate
            print("  -> Transcoding to locked 30fps CFR, synchronized audio, faststart...")
            ffmpeg_cmd = [
                "ffmpeg", "-y", "-i", str(raw_path),
                "-vf", "scale='if(gt(iw,ih),min(1280,iw),-2)':'if(gt(iw,ih),-2,min(1280,ih))',format=yuv420p",
                "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
                "-maxrate", "2200k", "-bufsize", "4400k",
                "-r", "30",
                "-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-ac", "2",
                "-af", "aresample=async=1000",
                "-shortest",
                "-movflags", "+faststart",
                str(fixed_path)
            ]
            f_res = subprocess.run(ffmpeg_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            if f_res.returncode == 0 and fixed_path.exists():
                fixed_size = fixed_path.stat().st_size
                print(f"  Fixed size: {fixed_size / 1024 / 1024:.2f} MB. Uploading back to R2...")
                s3.upload_file(
                    str(fixed_path),
                    r2_bucket,
                    key,
                    ExtraArgs={'ContentType': 'video/mp4', 'CacheControl': 'public, max-age=31536000'}
                )
                print(f"  ✅ Video {vid_id} successfully repaired and uploaded to R2!")
            else:
                print(f"  ❌ FFmpeg failed: {f_res.stderr.decode()[:200]}")
    except Exception as e:
        print(f"  Error processing {vid_id}: {e}")
    finally:
        if raw_path.exists():
            raw_path.unlink()
        if fixed_path.exists():
            fixed_path.unlink()

print("\nRepair script finished.")
