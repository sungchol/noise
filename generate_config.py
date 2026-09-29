"""
API_BASE 값을 읽어 exhibition/config.js 를 생성한다.
읽는 순서: 이미 설정된 환경 변수(API_BASE) > .env 파일의 API_BASE > 빈 값.
로컬 개발과 GitHub Actions 배포가 이 스크립트 하나를 함께 쓴다.

로컬 실행:
    python scripts/generate_config.py
GitHub Actions 실행 (워크플로에서):
    API_BASE=${{ vars.API_BASE }} python scripts/generate_config.py
"""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent
print("Root", ROOT)

def load_dotenv_simple(path: Path) -> None:
    """외부 패키지 없이 최소한의 .env 파싱만 지원한다 (KEY=VALUE, # 주석, 빈 줄)."""
    if not path.exists():
        print("파일없다")
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or line.startswith("//") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip().strip('"').strip("'").strip(";")
        os.environ.setdefault(key, value)   # 이미 설정된 환경 변수(CI 등)가 .env보다 우선


load_dotenv_simple(ROOT / ".env")

api_base = os.environ.get("API_BASE", "")
out_path = ROOT / "config.js"
out_path.write_text(f'window.API_BASE = "{api_base}";\n', encoding="utf-8")
print(f"생성됨: {out_path}  (API_BASE={api_base or '(비어 있음)'})")