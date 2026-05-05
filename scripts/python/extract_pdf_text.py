#!/usr/bin/env python3
"""Extrae texto de un PDF (lista de precios) a stdout. Requiere: pip install pypdf"""
from __future__ import annotations

import sys
from pathlib import Path

try:
    from pypdf import PdfReader
except ImportError:
    print("Instale en el mismo intérprete que use Node (p. ej. py -3 -m pip install pypdf)", file=sys.stderr)
    sys.exit(1)


def main() -> None:
    if len(sys.argv) < 2:
        print("Uso: python extract_pdf_text.py <archivo.pdf>", file=sys.stderr)
        sys.exit(1)
    path = Path(sys.argv[1])
    if not path.is_file():
        print(f"No existe: {path}", file=sys.stderr)
        sys.exit(1)
    reader = PdfReader(str(path))
    parts: list[str] = []
    for page in reader.pages:
        parts.append(page.extract_text() or "")
    sys.stdout.write("\n".join(parts))


if __name__ == "__main__":
    main()
