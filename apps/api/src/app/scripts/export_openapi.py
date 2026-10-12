"""Write the OpenAPI document to a file.

Usage: ``python -m app.scripts.export_openapi <out_path>``
"""

import json
import sys
from pathlib import Path


def export(out_path: Path) -> Path:
    from app.main import app

    schema = app.openapi()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(schema, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return out_path


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    if len(args) != 1:
        print("usage: python -m app.scripts.export_openapi <out_path>", file=sys.stderr)
        return 2
    path = export(Path(args[0]))
    print(f"Wrote OpenAPI schema to {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
