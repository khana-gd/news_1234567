#!/usr/bin/env python3
import os
import sys
import argparse
import requests
from pathlib import Path
from dotenv import load_dotenv

# Load .env relative to this file
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')
# Also try parent directory .env
load_dotenv(ROOT_DIR.parent / '.env')

# Setup ANSI colors
GREEN = "\033[92m"
RED = "\033[91m"
YELLOW = "\033[93m"
CYAN = "\033[96m"
BOLD = "\033[1m"
RESET = "\033[0m"

def print_status(component, success, message, details=None):
    symbol = f"{GREEN}[OK]{RESET}" if success else f"{RED}[FAIL]{RESET}"
    color = GREEN if success else RED
    print(f"{symbol} {BOLD}{component}:{RESET} {color}{message}{RESET}")
    if details:
        print(f"    Detail: {details}")

def test_mongodb(mongo_url, db_name):
    if not mongo_url:
        print_status("MongoDB Direct Connection", False, "Skipped - MONGO_URL not provided.")
        return False
    
    # Hide the credentials in print for safety
    safe_url = mongo_url
    if "@" in mongo_url:
        try:
            parts = mongo_url.split("@")
            prefix = parts[0].split("://")
            safe_url = f"{prefix[0]}://****:****@{parts[1]}"
        except Exception:
            safe_url = "mongodb://****:****@..."
            
    print(f"Connecting to MongoDB: {CYAN}{safe_url}{RESET} (Database: {CYAN}{db_name or 'Not specified'}{RESET})...")
    
    try:
        import pymongo
    except ImportError:
        print_status("MongoDB Direct Connection", False, "Missing pymongo dependency. Install with: pip install pymongo")
        return False
        
    try:
        # Create client with short timeout so it doesn't hang
        client = pymongo.MongoClient(mongo_url, serverSelectionTimeoutMS=3000)
        # Force connection verification
        client.admin.command('ping')
        
        # Check database access if db_name provided
        if db_name:
            db = client[db_name]
            # Try to list collections as a check
            collections = db.list_collection_names()
            db_info = f"Access OK. Collections found: {len(collections)}"
        else:
            db_info = "Connection OK"
            
        print_status("MongoDB Direct Connection", True, "Successfully connected and pinged database.", db_info)
        return True
    except Exception as e:
        print_status("MongoDB Direct Connection", False, "Failed to connect to MongoDB.", str(e))
        return False

def test_backend_api(backend_url):
    if not backend_url:
        print_status("Backend API Connection", False, "Skipped - Backend URL not provided.")
        return False
        
    # Clean trailing slash if present
    backend_url = backend_url.rstrip('/')
    health_url = f"{backend_url}/api/health"
    
    print(f"Pinging Backend API: {CYAN}{health_url}{RESET}...")
    
    try:
        resp = requests.get(health_url, timeout=10)
        
        if resp.status_code == 200:
            data = resp.json()
            db_status = data.get("services", {}).get("mongodb", {}).get("status", "unknown")
            if db_status == "connected":
                db_msg = f"{GREEN}MongoDB is connected to the backend.{RESET}"
            else:
                db_msg = f"{RED}MongoDB status at backend: {db_status}.{RESET}"
                
            print_status("Backend API Connection", True, f"Server is online and healthy. (HTTP {resp.status_code})", 
                         f"Backend Report: Status={data.get('status')}, MongoDB={db_msg}")
            return True
        elif resp.status_code == 503:
            # Service unavailable (likely MongoDB is down but server is running)
            try:
                data = resp.json()
                db_error = data.get("services", {}).get("mongodb", {}).get("error", "Unknown error")
                details = f"Server returned 503. Backend report: MongoDB status is disconnected. Error: {db_error}"
            except Exception:
                details = f"Server returned 503. Response body: {resp.text}"
            print_status("Backend API Connection", False, f"Server is online but reported errors (HTTP {resp.status_code}).", details)
            return False
        else:
            print_status("Backend API Connection", False, f"Server returned error code (HTTP {resp.status_code}).", resp.text[:200])
            return False
    except requests.exceptions.Timeout:
        print_status("Backend API Connection", False, "Connection timed out. (Timeout = 10s)", f"Is the server running at {backend_url}?")
        return False
    except requests.exceptions.ConnectionError as e:
        print_status("Backend API Connection", False, "Failed to connect to the server (Connection Error).", str(e))
        return False
    except Exception as e:
        print_status("Backend API Connection", False, "An unexpected error occurred while calling the API.", str(e))
        return False

def main():
    parser = argparse.ArgumentParser(description="Diagnostic utility to check connection to MongoDB and backend API.")
    parser.add_argument("--backend-url", default=os.getenv("EXPO_PUBLIC_BACKEND_URL", "https://public-samachar-api.onrender.com"),
                        help="Backend URL to verify. Defaults to EXPO_PUBLIC_BACKEND_URL or Render URL.")
    parser.add_argument("--mongo-url", default=os.getenv("MONGO_URL"),
                        help="MongoDB URL to test directly. Defaults to MONGO_URL env var.")
    parser.add_argument("--db-name", default=os.getenv("DB_NAME", "public-samachara"),
                        help="MongoDB Database Name to test directly. Defaults to DB_NAME env var.")
    
    args = parser.parse_args()
    
    print(f"\n{BOLD}=== Diagnostic Run ==={RESET}\n")
    
    # 1. Direct MongoDB Connection Check
    mongo_ok = test_mongodb(args.mongo_url, args.db_name)
    print()
    
    # 2. Web Server Healthcheck Endpoint Check
    backend_ok = test_backend_api(args.backend_url)
    print()
    
    print(f"{BOLD}=== Diagnostic Summary ==={RESET}")
    status_summary = []
    if mongo_ok:
        status_summary.append(f"MongoDB Direct: {GREEN}PASSED{RESET}")
    elif args.mongo_url:
        status_summary.append(f"MongoDB Direct: {RED}FAILED{RESET}")
    else:
        status_summary.append(f"MongoDB Direct: {YELLOW}SKIPPED (no URL){RESET}")
        
    if backend_ok:
        status_summary.append(f"Backend Link: {GREEN}PASSED{RESET}")
    else:
        status_summary.append(f"Backend Link: {RED}FAILED{RESET}")
        
    print(" | ".join(status_summary))
    print()
    
    # Exit code based on backend status primarily, as it is the link being tested
    if not backend_ok:
        sys.exit(1)
    sys.exit(0)

if __name__ == "__main__":
    main()
