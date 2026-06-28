#!/usr/bin/env python3
"""VAPID キーを生成し .env.local 用の行を出力する。

使い方:
  python scripts/gen_vapid_keys.py [mailto:your@email.com]
"""

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "backend"


def main() -> None:
    subject = sys.argv[1] if len(sys.argv) > 1 else "mailto:admin@example.com"

    subprocess.run(
        [sys.executable, "-m", "py_vapid", "--gen"],
        cwd=BACKEND,
        check=True,
    )

    private_pem = (BACKEND / "private_key.pem").read_text()
    public_pem = (BACKEND / "public_key.pem").read_text()

    result = subprocess.run(
        [sys.executable, "-m", "py_vapid", "--applicationServerKey"],
        cwd=BACKEND,
        capture_output=True,
        text=True,
        check=True,
    )
    app_server_key = ""
    for line in result.stdout.splitlines():
        if "Application Server Key" in line:
            app_server_key = line.split("=", 1)[1].strip()
            break

    if not app_server_key:
        print("ERROR: Application Server Key の取得に失敗しました", file=sys.stderr)
        sys.exit(1)

    private_one_line = private_pem.replace("\n", "\\n")

    print("# 以下を .env.local に追加してください")
    print(f"VAPID_PUBLIC_KEY={app_server_key}")
    print(f'VAPID_PRIVATE_KEY={private_one_line}')
    print(f"VAPID_SUBJECT={subject}")
    print()
    print("# PEM ファイル (backend/private_key.pem) は git 管理外にしてください")


if __name__ == "__main__":
    main()
