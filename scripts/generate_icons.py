#!/usr/bin/env python3
"""icon.svg から PWA 用 PNG アイコンを生成する。"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
FRONTEND = ROOT / "frontend"
SVG = FRONTEND / "icon.svg"
VERSION = json.loads((ROOT / "version.json").read_text())["version"]

OUTPUTS = [
    ("icon-192.png", 192),
    ("icon-512.png", 512),
    ("apple-touch-icon.png", 180),
]


def main() -> None:
    if not SVG.is_file():
        print(f"エラー: {SVG} が見つかりません", file=sys.stderr)
        sys.exit(1)

    for name, size in OUTPUTS:
        out = FRONTEND / name
        subprocess.run(
            [
                "convert",
                "-background",
                "none",
                str(SVG),
                "-resize",
                f"{size}x{size}",
                str(out),
            ],
            check=True,
        )
        print(f"生成: {out.name}")

    print(f"manifest / HTML のアイコン URL は ?v={VERSION} に合わせてください。")


if __name__ == "__main__":
    main()
