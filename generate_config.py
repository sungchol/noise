"""
API_BASE 값을 읽어 config.js 를 생성한다.

GitHub Actions 실행 (워크플로에서):
    API_BASE=${{ vars.API_BASE }} python generate_config.py
"""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent

api_base = os.environ.get("API_BASE", "").strip().strip('"').strip("'").strip(";")
out_path = ROOT / "config.js"
out_path.write_text(f'window.API_BASE = "{api_base}";\n', encoding="utf-8")
print(f"생성됨: {out_path}  (API_BASE={api_base})")