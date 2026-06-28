#!/usr/bin/env python3
"""
バージョンを上げて changelog.js にスタブを追加する。

使い方:
  python scripts/bump_version.py patch   # 0.1.0 -> 0.1.1
  python scripts/bump_version.py minor   # 0.1.0 -> 0.2.0
  python scripts/bump_version.py major   # 0.1.0 -> 1.0.0
"""
import json
import re
import sys
from datetime import datetime
from pathlib import Path

try:
    from zoneinfo import ZoneInfo
except ImportError:
    from backports.zoneinfo import ZoneInfo  # Python 3.8 fallback

ROOT = Path(__file__).parent.parent
VERSION_FILE = ROOT / "version.json"
CHANGELOG_FILE = ROOT / "frontend" / "changelog.js"


def bump(version: str, kind: str) -> str:
    major, minor, patch = map(int, version.split("."))
    if kind == "major":
        return f"{major + 1}.0.0"
    if kind == "minor":
        return f"{major}.{minor + 1}.0"
    return f"{major}.{minor}.{patch + 1}"


def today_jst() -> str:
    return datetime.now(ZoneInfo("Asia/Tokyo")).strftime("%Y-%m-%d")


def main() -> None:
    if len(sys.argv) != 2 or sys.argv[1] not in ("patch", "minor", "major"):
        print("使い方: python scripts/bump_version.py [patch|minor|major]")
        sys.exit(1)

    kind = sys.argv[1]

    data = json.loads(VERSION_FILE.read_text())
    old_version = data["version"]
    new_version = bump(old_version, kind)

    data["version"] = new_version
    VERSION_FILE.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"version.json: {old_version} -> {new_version}")

    content = CHANGELOG_FILE.read_text(encoding="utf-8")

    if f"version: '{new_version}'" in content:
        print(f"changelog.js にはすでに v{new_version} のエントリがあります。スキップします。")
    else:
        content = re.sub(
            r"(const APP_VERSION = ')[^']+'",
            f"\\g<1>{new_version}'",
            content,
        )
        stub = (
            f"  {{\n"
            f"    version: '{new_version}',\n"
            f"    date: '{today_jst()}',\n"
            f"    changes: [\n"
            f"      '（変更内容を追記してください）',\n"
            f"    ],\n"
            f"  }},\n"
        )
        marker = "const APP_CHANGELOG = [\n"
        if marker not in content:
            print("警告: APP_CHANGELOG マーカーが見つかりません。changelog.js を確認してください。")
        else:
            content = content.replace(marker, marker + stub)
            print(f"changelog.js に v{new_version} のスタブを追加しました。")

    CHANGELOG_FILE.write_text(content, encoding="utf-8")


if __name__ == "__main__":
    main()
