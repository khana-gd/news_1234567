import asyncio
import sys
import os

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from server import d1_query_async, ensure_d1_tables

async def main():
    ensure_d1_tables()
    
    mock_id = "cf_test_mock_123"
    await d1_query_async(
        """INSERT OR REPLACE INTO news_feed 
           (id, title, description, location, video_url, thumb_url, reporter_name, timestamp, views, aspect_ratio) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        [
            mock_id,
            "Test Mock Video for Moderation",
            "This is a test video to verify that deleting works end-to-end.",
            "Bengaluru",
            "https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4",
            "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe",
            "Inspector Agent",
            1785604169695,
            15,
            "16:9"
        ]
    )
    print(f"Mock video inserted successfully: {mock_id}")

if __name__ == "__main__":
    asyncio.run(main())
