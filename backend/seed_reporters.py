#!/usr/bin/env python3
"""
Seed Reporter Accounts — Public Samachar
Seeds the 15 individual reporter accounts into Cloudflare D1 (and local SQLite fallback)
with hashed passwords (bcrypt / pbkdf2) and exports a private credentials sheet.
"""
import os
import sys
import sqlite3
import hashlib
import secrets
from datetime import datetime, timezone
from pathlib import Path

# Try to import from server if running within backend directory
try:
    from server import d1_query, hash_password, verify_password
except ImportError:
    # Standalone hashing fallback
    def hash_password(password: str) -> str:
        try:
            import bcrypt
            return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
        except Exception:
            salt = secrets.token_hex(16)
            h = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt.encode('utf-8'), 100000).hex()
            return f"pbkdf2_sha256${salt}${h}"

    def verify_password(plain_password: str, hashed_password: str) -> bool:
        if not hashed_password or not plain_password:
            return False
        if hashed_password.startswith(('$2b$', '$2a$', '$2y$')):
            try:
                import bcrypt
                return bcrypt.checkpw(plain_password.encode('utf-8'), hashed_password.encode('utf-8'))
            except Exception:
                return False
        elif hashed_password.startswith('pbkdf2_sha256$'):
            parts = hashed_password.split('$')
            if len(parts) == 3:
                salt = parts[1]
                expected_hex = parts[2]
                computed_hex = hashlib.pbkdf2_hmac(
                    'sha256', plain_password.encode('utf-8'), salt.encode('utf-8'), 100000
                ).hex()
                return secrets.compare_digest(computed_hex, expected_hex)
        return False

    def d1_query(sql: str, params: list = None) -> list:
        db_path = Path(__file__).parent / "d1_local.db"
        conn = sqlite3.connect(str(db_path))
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        if params:
            cursor.execute(sql, params)
        else:
            cursor.execute(sql)
        if sql.strip().upper().startswith(("SELECT", "PRAGMA")):
            res = [dict(row) for row in cursor.fetchall()]
        else:
            conn.commit()
            res = []
        conn.close()
        return res

# ── 15 EXACT REPORTERS ─────────────────────────────────────────────────────────
REPORTERS = [
    {
        "full_name": "ಶರಣಪ್ಪ ಗೋಲ್ಲರ",
        "username": "sharanappa.g",
        "password": "PS@1042",
        "district": "Karnataka",
        "role": "reporter",
        "auto_publish": 1,
    },
    {
        "full_name": "ನಾಗರಾಜ ಕೂಂಕುರ",
        "username": "nagaraja.k",
        "password": "PS@2085",
        "district": "Karnataka",
        "role": "reporter",
        "auto_publish": 1,
    },
    {
        "full_name": "ವಿರೇಶ. ಜೆ. ಹಾರೋಗೇರಿ",
        "username": "viresha.h",
        "password": "PS@3194",
        "district": "Karnataka",
        "role": "reporter",
        "auto_publish": 1,
    },
    {
        "full_name": "ಗಂಗಾಧರ.ಪಿ.ಕತ್ತಿ",
        "username": "gangadhara.k",
        "password": "PS@4276",
        "district": "Karnataka",
        "role": "reporter",
        "auto_publish": 1,
    },
    {
        "full_name": "ಕಾರ್ತಿಕ. ಪಿ",
        "username": "karthika.p",
        "password": "PS@5318",
        "district": "Karnataka",
        "role": "reporter",
        "auto_publish": 1,
    },
    {
        "full_name": "ಬಸವರಾಜ. ಎಸ್. ದೀಪಾವಳಿ",
        "username": "basavaraja.d",
        "password": "PS@6492",
        "district": "Karnataka",
        "role": "reporter",
        "auto_publish": 1,
    },
    {
        "full_name": "ರಾಘವೇಂದ್ರ ವಿ. ಕಡೆಮನಿ",
        "username": "raghavendra.k",
        "password": "PS@7531",
        "district": "Karnataka",
        "role": "reporter",
        "auto_publish": 1,
    },
    {
        "full_name": "ಹಸನಸಾಬ ನಧಾಪ್",
        "username": "hasanasaba.n",
        "password": "PS@8640",
        "district": "Karnataka",
        "role": "reporter",
        "auto_publish": 1,
    },
    {
        "full_name": "ವಿನಾಯಕ ಎನ್. ಗುಡ್ಡದಕೆರಿ",
        "username": "vinayaka.g",
        "password": "PS@9725",
        "district": "Karnataka",
        "role": "reporter",
        "auto_publish": 1,
    },
    {
        "full_name": "ಜಯಂತ ಕೆ. ವಾಡೇದ್",
        "username": "jayantha.w",
        "password": "PS@1853",
        "district": "Karnataka",
        "role": "reporter",
        "auto_publish": 1,
    },
    {
        "full_name": "ಮಾಹತೇಂಶ ಎಮ್. ಹಕ್ಕರಕಿ",
        "username": "mahantesha.h",
        "password": "PS@2964",
        "district": "Karnataka",
        "role": "reporter",
        "auto_publish": 1,
    },
    {
        "full_name": "ಕೇಶವ್ ಟಿ. ಕಟ್ಟಿಮನಿ",
        "username": "keshav.k",
        "password": "PS@3471",
        "district": "Karnataka",
        "role": "reporter",
        "auto_publish": 1,
    },
    {
        "full_name": "ಅಭಿಷೇಕ್ ಆರ್. ಕಲಾಲ",
        "username": "abhishek.k",
        "password": "PS@4589",
        "district": "Karnataka",
        "role": "reporter",
        "auto_publish": 1,
    },
    {
        "full_name": "ವಾಸುದೇವ ಎಸ್. ಮುರಗಿ",
        "username": "vasudeva.m",
        "password": "PS@5623",
        "district": "Karnataka",
        "role": "reporter",
        "auto_publish": 1,
    },
    {
        "full_name": "ವಡ್ಲಮುಡಿ ಬಾಲ. ಚೆನ್ನಯ್ಯ",
        "username": "bala.chennaiah",
        "password": "PS@6748",
        "district": "Karnataka",
        "role": "reporter",
        "auto_publish": 1,
    },
]

# Additional standard admin accounts for testing and moderation
EXTRA_ACCOUNTS = [
    {
        "full_name": "Girish P.S.",
        "username": "girish.p.s",
        "password": "newskannada.p.s",
        "district": "Hubballi",
        "role": "admin",
        "auto_publish": 1,
    },
    {
        "full_name": "Administrator",
        "username": "admin",
        "password": "PS2026",
        "district": "Headquarters",
        "role": "admin",
        "auto_publish": 1,
    },
]


def seed():
    print("=================================================================")
    print("Public Samachar — Seeding Reporter Accounts to Cloudflare D1")
    print("=================================================================")

    # 1. Ensure table exists in D1 and local SQLite
    table_sql = """CREATE TABLE IF NOT EXISTS reporters (
        id TEXT PRIMARY KEY,
        full_name TEXT NOT NULL DEFAULT '',
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        district TEXT DEFAULT 'Karnataka',
        role TEXT DEFAULT 'reporter',
        auto_publish INTEGER DEFAULT 1,
        is_active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT ''
    )"""
    try:
        d1_query(table_sql)
        print("✓ Checked / created 'reporters' table in D1 / local SQLite.")
    except Exception as e:
        print(f"Warning creating table: {e}")

    # Also directly ensure local SQLite d1_local.db has the table
    local_db_path = Path(__file__).parent / "d1_local.db"
    try:
        conn = sqlite3.connect(str(local_db_path))
        conn.execute(table_sql)
        conn.commit()
        conn.close()
        print("✓ Local SQLite d1_local.db table ensured.")
    except Exception as e:
        print(f"Local SQLite error: {e}")

    all_accounts = REPORTERS + EXTRA_ACCOUNTS
    now_iso = datetime.now(timezone.utc).isoformat()

    credentials_lines = [
        "================================================================================",
        "PUBLIC SAMACHAR — REPORTER CREDENTIALS (CONFIDENTIAL / PRIVATE)",
        f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        "DO NOT COMMIT THIS FILE TO VERSION CONTROL OR REPOSITORY.",
        "Use these credentials for individual WhatsApp delivery to reporters.",
        "================================================================================\n",
    ]

    count = 0
    for i, rep in enumerate(all_accounts, 1):
        username = rep["username"].strip().lower()
        full_name = rep["full_name"].strip()
        plain_pwd = rep["password"].strip()
        district = rep.get("district", "Karnataka")
        role = rep.get("role", "reporter")
        auto_pub = rep.get("auto_publish", 1)
        rep_id = f"rep_{username.replace('.', '_')}"

        pwd_hash = hash_password(plain_pwd)

        # Upsert into D1 / SQLite
        upsert_sql = """INSERT OR REPLACE INTO reporters 
            (id, full_name, username, password_hash, district, role, auto_publish, is_active, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)"""
        params = [rep_id, full_name, username, pwd_hash, district, role, auto_pub, now_iso]

        try:
            d1_query(upsert_sql, params)
        except Exception as e:
            print(f"Error seeding {username} in D1: {e}")

        # Also write to local SQLite directly
        try:
            conn = sqlite3.connect(str(local_db_path))
            conn.execute(upsert_sql, params)
            conn.commit()
            conn.close()
        except Exception as e:
            print(f"Local SQLite upsert error for {username}: {e}")

        count += 1
        print(f"[{count:02d}] Seeded: {full_name} | user: {username} | role: {role}")

        credentials_lines.append(
            f"{i:02d}. ಹೆಸರು (Name):     {full_name}\n"
            f"    ಜಿಲ್ಲೆ (District): {district}\n"
            f"    ಬಳಕೆದಾರ (Username): {username}\n"
            f"    ಗುಪ್ತಪದ (Password): {plain_pwd}\n"
            f"    ರೋಲ್ (Role):       {role.upper()}\n"
            "--------------------------------------------------------------------------------"
        )

    # 2. Write private credentials file
    private_file = Path(__file__).parent / "reporter_credentials_PRIVATE.txt"
    private_file.write_text("\n".join(credentials_lines), encoding="utf-8")
    print(f"\n✓ Generated PRIVATE credentials sheet: {private_file}")
    print("✓ Passwords have been securely hashed before saving to database.")

    # 3. Check .gitignore
    root_gitignore = Path(__file__).parent.parent / ".gitignore"
    if root_gitignore.exists():
        content = root_gitignore.read_text(encoding="utf-8")
        if "reporter_credentials_PRIVATE.txt" in content:
            print("✓ Confirmed: reporter_credentials_PRIVATE.txt is listed in .gitignore.")
        else:
            root_gitignore.write_text(content + "\nbackend/reporter_credentials_PRIVATE.txt\n*reporter_credentials*\n", encoding="utf-8")
            print("✓ Appended private credentials sheet to .gitignore.")

    print(f"\nSeeding complete! Total {count} accounts created/updated.")


if __name__ == "__main__":
    seed()
