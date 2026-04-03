"""
Parse lista_precios_extracted.txt (from lista de precios.rtf) and assign 5 list prices.

Rules (user):
1) Usar el conjunto de precios más reciente (por fecha/hora).
2) Cananea = el único con decimales (no .00 entero).
3) Regular = el más caro.
4) Técnico = el segundo más caro.
5) Mayoreo - (mayorista menor) = segundo más barato.
6) Mayoreo + (mayorista mayor) = el más barato.

Mapeo a IDs en app: regular, tecnico, mayoreo_menos, mayoreo_mas, cananea
"""

from __future__ import annotations

import csv
import re
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

# Línea de precio: usuario, fecha, $monto
PRICE_LINE = re.compile(
    r"^\t(?P<user>\S+)\s+"
    r"(?P<dt>\d{2}/\d{2}/\d{4}\s+\d{1,2}:\d{2}:\d{2}\s*[ap]\.\s*m\.)\s+"
    r"\$(?P<price>[0-9,]+\.?[0-9]*)\s*$",
    re.IGNORECASE,
)


def parse_dt(s: str) -> datetime:
    s = " ".join(s.split())
    # 11/06/2024 04:03:21p. m.
    s = s.replace("a. m.", "AM").replace("p. m.", "PM")
    return datetime.strptime(s, "%d/%m/%Y %I:%M:%S%p")


def parse_price(s: str) -> float:
    return float(s.replace(",", ""))


def money_key(p: float) -> tuple:
    """Ordenar de mayor a menor."""
    return (-p,)


@dataclass
class ProductBlock:
    sku: str
    nombre: str
    rows: list[tuple[datetime, float]] = field(default_factory=list)


def is_new_product(i: int, lines: list[str]) -> bool:
    return (
        i + 2 < len(lines)
        and lines[i].startswith("\t")
        and lines[i + 1].strip() == "Código:"
        and not lines[i].strip().startswith("Código")
    )


def split_blocks(text: str) -> list[ProductBlock]:
    lines = text.splitlines()
    blocks: list[ProductBlock] = []
    i = 0
    while i < len(lines):
        if is_new_product(i, lines):
            sku = lines[i][1:].strip()
            nombre = lines[i + 2].strip()
            i += 3
            rows: list[tuple[datetime, float]] = []
            while i < len(lines):
                if is_new_product(i, lines):
                    break
                ln = lines[i]
                m = PRICE_LINE.match(ln)
                if m:
                    try:
                        dt = parse_dt(m.group("dt"))
                        pr = parse_price(m.group("price"))
                        rows.append((dt, pr))
                    except Exception:
                        pass
                    i += 1
                    continue
                # línea en blanco o basura entre productos
                if not ln.strip():
                    i += 1
                    continue
                # categoría sin tab (ej. ACCESORIOS)
                if ln.strip() and not ln.startswith("\t"):
                    break
                i += 1
            blocks.append(ProductBlock(sku=sku, nombre=nombre, rows=rows))
            continue
        i += 1
    return blocks


def pick_recent_prices(rows: list[tuple[datetime, float]]) -> list[float]:
    """
    Toma **todos** los precios del **día calendario más reciente** que tenga movimientos.
    Así no se pierde el precio Cananea (con decimales) si hubo más de 5 capturas el mismo día.
    Si no hay filas, []. Si solo hay días viejos, usa las últimas 5 filas globales como respaldo.
    """
    if not rows:
        return []
    rows_sorted = sorted(rows, key=lambda x: x[0])
    latest_date = max(r[0].date() for r in rows_sorted)
    same_day = [r for r in rows_sorted if r[0].date() == latest_date]
    if same_day:
        return [p for _, p in same_day]
    if len(rows_sorted) >= 5:
        return [p for _, p in rows_sorted[-5:]]
    return [p for _, p in rows_sorted]


def assign_lists(prices: list[float]) -> dict[str, float | None]:
    """Usa valores únicos del pool del día más reciente (puede haber >5 filas)."""
    out: dict[str, float | None] = {
        "regular": None,
        "tecnico": None,
        "cananea": None,
        "mayoreo_menos": None,
        "mayoreo_mas": None,
    }
    if not prices:
        return out
    uniq = sorted(set(prices), reverse=True)
    if len(uniq) >= 2:
        out["regular"] = uniq[0]
        out["tecnico"] = uniq[1]
    elif len(uniq) == 1:
        out["regular"] = uniq[0]

    uniq_asc = sorted(set(prices))
    if len(uniq_asc) >= 2:
        out["mayoreo_mas"] = uniq_asc[0]
        out["mayoreo_menos"] = uniq_asc[1]
    elif len(uniq_asc) == 1:
        out["mayoreo_mas"] = uniq_asc[0]

    # Cananea: único precio con centavos distintos de .00 (sobre valores únicos)
    decimal_vals = [p for p in uniq_asc if abs(p - round(p)) > 1e-6]
    if len(decimal_vals) == 1:
        out["cananea"] = decimal_vals[0]
    elif len(decimal_vals) > 1:
        out["cananea"] = None

    return out


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    src = root / "lista_precios_extracted.txt"
    if not src.exists():
        print("Falta lista_precios_extracted.txt en la raíz del proyecto.")
        return
    text = src.read_text(encoding="utf-8", errors="replace")
    blocks = split_blocks(text)

    out_csv = root / "lista_precios_por_lista.csv"
    ambig = root / "lista_precios_ambiguos.txt"

    amb_lines: list[str] = []
    with out_csv.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(
            [
                "sku",
                "nombre",
                "regular",
                "tecnico",
                "cananea",
                "mayoreo_menos",
                "mayoreo_mas",
                "notas",
            ]
        )
        for b in blocks:
            picked = pick_recent_prices(b.rows)
            note_parts: list[str] = []
            if len(set(picked)) < 2 and picked:
                note_parts.append("un_solo_precio_distinto")
            assigned = assign_lists(picked)

            uniq_p = sorted(set(picked))
            decimal_vals = [p for p in uniq_p if abs(p - round(p)) > 1e-6]
            if len(decimal_vals) > 1:
                note_parts.append("varios_con_decimales")
                amb_lines.append(
                    f"[{b.sku}] {b.nombre[:60]} — decimales: {decimal_vals}"
                )
            if len(decimal_vals) == 0 and picked:
                note_parts.append("sin_decimal_para_cananea")
                amb_lines.append(f"[{b.sku}] {b.nombre[:60]} — sin precio con centavos")

            w.writerow(
                [
                    b.sku,
                    b.nombre.replace("\n", " "),
                    f"{assigned['regular']:.2f}" if assigned["regular"] is not None else "",
                    f"{assigned['tecnico']:.2f}" if assigned["tecnico"] is not None else "",
                    f"{assigned['cananea']:.2f}" if assigned["cananea"] is not None else "",
                    f"{assigned['mayoreo_menos']:.2f}" if assigned["mayoreo_menos"] is not None else "",
                    f"{assigned['mayoreo_mas']:.2f}" if assigned["mayoreo_mas"] is not None else "",
                    ";".join(note_parts),
                ]
            )

    ambig.write_text("\n".join(amb_lines[:500]), encoding="utf-8")
    print(f"Productos: {len(blocks)}")
    print(f"CSV: {out_csv}")
    print(f"Ambiguos (primeros 500): {ambig} ({len(amb_lines)} lineas)")


if __name__ == "__main__":
    main()
