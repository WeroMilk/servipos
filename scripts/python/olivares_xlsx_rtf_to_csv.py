#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
Lee una carpeta de inventario Olivares (.xlsx) + lista de precios Crystal (.rtf)
y genera un CSV compatible con:

  npm run import:csv-olivares-to-supabase -- --csv=./data/salida.csv --sucursal=olivares

Columnas (mismas que merge-olivares-precios-rtf.mjs) + Existencia, Categoria, Archivo_origen.

Por defecto solo escribe filas que tienen precios en el RTF (~1371). Use
  --incluir-sin-precio-rtf
para escribir los 2660 artículos (sin match: precios y listas en 0) y poder importar
todos a Supabase; siga usando --export-sin-rtf para la lista de revisión.

Reglas de precios (igual que scripts Node en scripts/lib/olivaresRtfPrecios.mjs):
  - Del RTF se toman 5 importes con IVA; Cananea = el que tiene centavos distintos de .00
    (empate: menor; si ninguno tiene centavos: el menor de los cinco).
  - Regular, técnico, mayoreo -, mayoreo + = los otros cuatro, de mayor a menor.
  - Se convierten a sin IVA para el catálogo.

Orden de los 5 precios leídos del bloque RTF:
  - legacy: igual que Node (primeras 5 líneas con $ por fecha ascendente).
  - mas-recientes: las 5 fechas más recientes.

Dependencia: pip install -r scripts/python/requirements.txt

PowerShell: cd al repo; líneas continuadas con el caracter ^ al final.

Git Bash: cd ~/proyectos/SERVIpos; rutas /c/Users/... entre comillas; varias lineas con
barra invertida al final de cada linea (no usar sintaxis de PowerShell).

Ver docs/IMPORT_OLIVARES_INVENTARIO.md (seccion CSV con Python).
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import re
import sys
import unicodedata
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any

try:
    import openpyxl
except ImportError:
    print("Instale openpyxl: pip install -r scripts/python/requirements.txt", file=sys.stderr)
    sys.exit(1)

LIST_KEYS = ["regular", "tecnico", "cananea", "mayoreo_menos", "mayoreo_mas"]

INVENTORY_ALIASES = {
    "codigo": ["codigo", "código", "sku", "clave"],
    "descripcion": ["descripcion", "descripción", "nombre", "producto"],
    "actual": ["actual", "existencia", "stock"],
    "id": ["id"],
    "justificacion": ["justificacion", "justificación", "nota"],
}


def norm_header(s: Any) -> str:
    if s is None:
        return ""
    t = str(s).strip()
    t = unicodedata.normalize("NFD", t)
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    return " ".join(t.lower().split())


def norm_sku_key(s: Any) -> str:
    return str(s or "").strip().upper()


def norm_nombre_key(s: Any) -> str:
    t = str(s or "").strip()
    t = unicodedata.normalize("NFD", t)
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    return " ".join(t.upper().split())


def norm_nombre_key_loose(s: Any) -> str:
    t = norm_nombre_key(s)
    t = t.replace("Ñ", "N")
    t = re.sub(r"[^A-Z0-9 ]", " ", t)
    return " ".join(t.split())


def cell_str(v: Any) -> str:
    if v is None:
        return ""
    if isinstance(v, float) and v == int(v):
        return str(int(v))
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return str(v) if v == v else ""  # NaN
    return str(v).strip()


def parse_number(v: Any) -> float:
    if v is None or v == "":
        return 0.0
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return float(v)
    s = str(v).strip().replace(",", "")
    try:
        return float(s)
    except ValueError:
        return 0.0


def pick_by_aliases(row_map: dict[str, Any], aliases: list[str]) -> Any:
    for a in aliases:
        k = norm_header(a)
        if k in row_map:
            return row_map[k]
    return None


def strip_rtf_pict_blocks(rtf: str) -> str:
    s = rtf
    while True:
        i = s.find("{\\pict")
        if i < 0:
            break
        depth = 0
        j = i
        while j < len(s):
            c = s[j]
            if c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    j += 1
                    break
            j += 1
        s = s[:i] + s[j:]
    return s


def rtf_decode_name(fragment: str) -> str:
    def u_repl(m: re.Match[str]) -> str:
        return chr(int(m.group(1)))

    def hex_repl(m: re.Match[str]) -> str:
        return chr(int(m.group(1), 16))

    t = re.sub(r"\\u(-?\d+)\s*\?", u_repl, fragment)
    t = re.sub(r"\\'([0-9a-fA-F]{2})", hex_repl, t)
    t = t.replace("\\\\", "\\")
    t = t.replace("\\par", " ")
    return t.strip()


def extract_nombre_producto(block: str) -> str:
    m0 = re.search(r"\\cf0\\cf1\\b\s+([^\\]+?)\s*\\par", block)
    if m0:
        t = rtf_decode_name(m0.group(1))
        if t and not re.match(r"^c[oó]digo", t, re.I):
            return t
    for m in re.finditer(r"\\cf1\\b\s+([^\\]+?)\s*\\par", block):
        t = rtf_decode_name(m.group(1))
        if t and not re.match(r"^c[oó]digo", t, re.I) and len(t) > 2:
            return t
    return ""


TIER_BY_RANK = ["regular", "tecnico", "mayoreo_menos", "mayoreo_mas", "cananea"]
REAL_TS_MIN = 946684800.0  # > 2000-01-01 (segundos; alineado con ms en Node / 1000)


def parse_mx_datetime(s: str) -> float:
    """DD/MM/AAAA + hora; admite `a. m.` / `p. m.` al final (Crystal / PDF)."""
    s_norm = " ".join(s.strip().split())
    s_am = (
        s_norm.replace("a. m.", "AM")
        .replace("p. m.", "PM")
        .replace("a.m.", "AM")
        .replace("p.m.", "PM")
    )
    m12 = re.match(
        r"^(\d{1,2})/(\d{1,2})/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*([AP]M)$",
        s_am,
        re.I,
    )
    if m12:
        day_s, mo_s, y_s, hh_s, mm_s, ss_s, ap = m12.groups()
        hour = int(hh_s)
        if ap.upper() == "PM" and hour != 12:
            hour += 12
        if ap.upper() == "AM" and hour == 12:
            hour = 0
        try:
            return datetime(int(y_s), int(mo_s), int(day_s), hour, int(mm_s), int(ss_s)).timestamp()
        except ValueError:
            return 0.0
    m24 = re.match(
        r"^(\d{1,2})/(\d{1,2})/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$",
        s_norm,
    )
    if m24:
        day_s, mo_s, y_s, hh_s, mm_s, ss_s = m24.groups()
        try:
            return datetime(
                int(y_s), int(mo_s), int(day_s), int(hh_s), int(mm_s), int(ss_s)
            ).timestamp()
        except ValueError:
            return 0.0
    return 0.0


def is_real_ts(t: Any) -> bool:
    return isinstance(t, (int, float)) and float(t) > REAL_TS_MIN


def map_recent_con_iva_prices_to_lists(prices: list[float]) -> dict[str, float] | None:
    arr = [float(p) for p in prices if isinstance(p, (int, float)) and float(p) >= 0]
    if not arr:
        return None
    arr_sorted = sorted(arr, reverse=True)
    out: dict[str, float] = {}
    for i, p in enumerate(arr_sorted[:5]):
        out[TIER_BY_RANK[i]] = p
    return out


def pick_recent_price_rows(rows: list[dict[str, Any]], pad5: bool) -> list[float]:
    if not rows:
        return []
    with_ord: list[dict[str, Any]] = [{**r, "ord": r.get("ord", i)} for i, r in enumerate(rows)]
    real = [r for r in with_ord if is_real_ts(r["t"])]
    ordered_pick: list[dict[str, Any]] = []
    if real:
        real.sort(key=lambda x: float(x["t"]), reverse=True)
        ordered_pick = real[:5]
        if len(ordered_pick) < 5:
            fake = [r for r in with_ord if not is_real_ts(r["t"])]
            fake.sort(key=lambda x: int(x["ord"]), reverse=True)
            for r in fake:
                if len(ordered_pick) >= 5:
                    break
                ordered_pick.append(r)
    else:
        copy = sorted(with_ord, key=lambda x: int(x["ord"]), reverse=True)
        ordered_pick = copy[:5]
    chosen = [float(r["price"]) for r in ordered_pick]
    if len(chosen) < 5 and pad5 and chosen:
        last = chosen[-1]
        while len(chosen) < 5:
            chosen.append(last)
    return chosen


def con_iva_a_sin_iva(con_iva: float, iva_pct: float) -> float:
    f = 1 + iva_pct / 100.0
    return round((con_iva / f) * 100) / 100


def parse_precios_rtf(
    rtf_text: str,
    *,
    pad5: bool,
    regla_precios: str,
) -> dict[str, dict[str, Any]]:
    """SKU normalizado -> { nombre, preciosConIva }. `regla_precios` se ignora (comportamiento unificado con Node)."""
    del regla_precios  # API estable; misma lógica que scripts/lib/olivaresRtfPrecios.mjs
    s = strip_rtf_pict_blocks(rtf_text)
    sku_re = re.compile(r"[\\]cf1\s+([A-Za-z0-9]{1,24})\s*\\par")
    hits = list(sku_re.finditer(s))
    out: dict[str, dict[str, Any]] = {}

    for i, m in enumerate(hits):
        sku_raw = m.group(1).strip()
        if not sku_raw or not re.search(r"\d", sku_raw):
            continue
        sku_key = norm_sku_key(sku_raw)
        start = m.start()
        end = hits[i + 1].start() if i + 1 < len(hits) else len(s)
        block = s[start:end]
        nombre = extract_nombre_producto(block)
        if not nombre:
            continue

        rows: list[dict[str, Any]] = []
        ord_i = 0
        for part in block.split("\\par"):
            if "$" not in part:
                continue
            price_m = re.search(r"\$(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)", part)
            if not price_m:
                continue
            price = float(price_m.group(1).replace(",", ""))
            time_m = re.search(
                r"(\d{1,2}/\d{1,2}/\d{4}\s+\d{1,2}:\d{2}:\d{2}(?:\s*[ap]\.\s*m\.)?)",
                part,
                re.I,
            )
            o = ord_i
            ord_i += 1
            t = parse_mx_datetime(time_m.group(1)) if time_m else float(o)
            rows.append({"t": t, "price": price, "ord": o})

        if not rows:
            continue

        prices_con_iva = pick_recent_price_rows(rows, pad5)
        if not prices_con_iva:
            continue

        precios_con_iva = map_recent_con_iva_prices_to_lists(prices_con_iva)
        if not precios_con_iva:
            continue

        out[sku_key] = {"nombre": nombre, "preciosConIva": precios_con_iva}

    return out


def build_precio_indexes(
    precios_map: dict[str, dict[str, Any]],
) -> tuple[dict[str, dict], dict[str, dict]]:
    by_nombre: dict[str, dict] = {}
    by_loose: dict[str, dict] = {}
    for v in precios_map.values():
        nk = norm_nombre_key(v["nombre"])
        if nk:
            by_nombre[nk] = v
        nl = norm_nombre_key_loose(v["nombre"])
        if nl:
            by_loose[nl] = v
    return by_nombre, by_loose


def match_row_to_precios(
    precios_map: dict[str, dict[str, Any]],
    by_nombre: dict[str, dict],
    by_loose: dict[str, dict],
    sku: str,
    nombre: str,
) -> tuple[dict[str, Any] | None, str]:
    sku_key = norm_sku_key(sku)
    p = precios_map.get(sku_key)
    if p:
        return p, "sku"
    p = by_nombre.get(norm_nombre_key(nombre))
    if p:
        return p, "nombre"
    p = by_loose.get(norm_nombre_key_loose(nombre))
    if p:
        return p, "nombreLoose"
    return None, ""


def normalize_product_nombre_key(nombre: str) -> str:
    return " ".join(str(nombre).strip().upper().split())


HEADER_LIKE = {
    "CODIGO",
    "CÓDIGO",
    "ID",
    "SKU",
    "DESCRIPCION",
    "DESCRIPCIÓN",
    "CLAVE",
}


def parse_inventory_workbook(path: Path, categoria: str) -> tuple[list[dict[str, Any]], list[dict]]:
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    try:
        ws = wb.active
        it = ws.iter_rows(values_only=True)
        header_row = next(it, None)
        if not header_row:
            return [], []
        col_keys = [norm_header(h) for h in header_row]
        out: list[dict[str, Any]] = []
        skipped: list[dict] = []
        for i, row in enumerate(it, start=2):
            row_map: dict[str, Any] = {}
            for j, val in enumerate(row):
                if j < len(col_keys) and col_keys[j]:
                    row_map[col_keys[j]] = val
            cod = pick_by_aliases(row_map, INVENTORY_ALIASES["codigo"])
            desc = pick_by_aliases(row_map, INVENTORY_ALIASES["descripcion"])
            act = pick_by_aliases(row_map, INVENTORY_ALIASES["actual"])
            id_cell = pick_by_aliases(row_map, INVENTORY_ALIASES["id"])
            just = pick_by_aliases(row_map, INVENTORY_ALIASES["justificacion"])

            sku_raw = cell_str(cod) if cod is not None else ""
            nombre_raw = cell_str(desc) if desc is not None else ""
            sku = norm_sku_key(sku_raw)
            nombre = normalize_product_nombre_key(nombre_raw)

            if not sku or not nombre:
                skipped.append(
                    {
                        "file": path.name,
                        "row": i,
                        "reason": "sin codigo" if not sku else "sin descripcion",
                    }
                )
                continue
            if sku in HEADER_LIKE or (len(nombre) < 40 and nombre in HEADER_LIKE):
                skipped.append({"file": path.name, "row": i, "reason": "fila encabezado o titulo"})
                continue

            existencia = parse_number(act)
            out.append(
                {
                    "sourceFile": path.name,
                    "rowIndex": i,
                    "categoria": categoria,
                    "sku": sku,
                    "nombre": nombre,
                    "existencia": existencia,
                    "idRef": cell_str(id_cell) if id_cell is not None else "",
                    "justTxt": cell_str(just) if just is not None else "",
                }
            )
        return out, skipped
    finally:
        wb.close()


def list_inventory_xlsx(dir_path: Path) -> list[Path]:
    files = sorted(
        p for p in dir_path.iterdir() if p.suffix.lower() == ".xlsx" and not p.name.startswith("~$")
    )
    return files


def merge_rows_from_dir(dir_path: Path, ultimo_gana: bool) -> dict[str, Any]:
    files = list_inventory_xlsx(dir_path)
    if not files:
        raise SystemExit(f"No hay archivos .xlsx en: {dir_path}")

    by_sku: dict[str, dict[str, Any]] = {}
    duplicate_skus: list[dict] = []
    per_file: list[dict] = []
    all_skipped: list[dict] = []

    for fp in files:
        cat = fp.stem
        rows, skipped = parse_inventory_workbook(fp, cat)
        all_skipped.extend(skipped)
        per_file.append({"file": fp.name, "count": len(rows), "skipped": len(skipped)})
        for r in rows:
            if r["sku"] not in by_sku:
                by_sku[r["sku"]] = r
            else:
                duplicate_skus.append(
                    {
                        "sku": r["sku"],
                        "first": by_sku[r["sku"]]["sourceFile"],
                        "second": r["sourceFile"],
                    }
                )
                if ultimo_gana:
                    by_sku[r["sku"]] = r

    return {
        "by_sku": by_sku,
        "duplicate_skus": duplicate_skus,
        "per_file": per_file,
        "all_skipped": all_skipped,
        "files": files,
    }


def disambiguate_nombres(rows: list[dict[str, Any]]) -> None:
    by_name: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for r in rows:
        by_name[normalize_product_nombre_key(r["nombre"])].append(r)
    for lst in by_name.values():
        if len(lst) <= 1:
            continue
        for r in lst:
            r["nombre"] = f"{r['nombre']} ({r['sku']})"


def csv_escape_field(val: str) -> str:
    if any(c in val for c in '",\r\n'):
        return '"' + val.replace('"', '""') + '"'
    return val


def main() -> None:
    ap = argparse.ArgumentParser(description="Excel inventario + RTF precios → CSV SERVIPARTZ")
    ap.add_argument("--dir", required=True, help="Carpeta con los .xlsx")
    ap.add_argument("--rtf", required=True, help="Ruta a lista de precios.rtf")
    ap.add_argument(
        "--out",
        default="data/olivares-xlsx-rtf.csv",
        help="CSV de salida (UTF-8 con BOM)",
    )
    ap.add_argument(
        "--ultimo-gana",
        action="store_true",
        help="Si un SKU está en varios Excel, gana el último archivo (orden alfabético)",
    )
    ap.add_argument("--iva", type=float, default=16.0, help="IVA %% para convertir precios con IVA → sin IVA")
    ap.add_argument(
        "--sin-iva-en-rtf",
        action="store_true",
        help="Los importes del RTF ya vienen sin IVA (no dividir)",
    )
    ap.add_argument(
        "--pad-5",
        action="store_true",
        help="Si hay menos de 5 precios, repetir el último hasta completar 5",
    )
    ap.add_argument(
        "--regla-precios",
        choices=("legacy", "mas-recientes"),
        default="legacy",
        help="legacy = igual que Node (primeras 5 por fecha ascendente). "
        "mas-recientes = 5 líneas más recientes por fecha.",
    )
    ap.add_argument(
        "--export-sin-rtf",
        default="",
        help="Opcional: CSV con SKU,Nombre,Archivo para filas sin match en RTF",
    )
    ap.add_argument(
        "--incluir-sin-precio-rtf",
        action="store_true",
        help="Escribir también artículos sin precio en RTF (precio y 5 listas = 0). Así el CSV tiene todos los SKU del Excel.",
    )
    args = ap.parse_args()

    dir_path = Path(args.dir).expanduser().resolve()
    rtf_path = Path(args.rtf).expanduser().resolve()
    out_path = Path(args.out).expanduser().resolve()

    if not dir_path.is_dir():
        print(f"No es carpeta: {dir_path}", file=sys.stderr)
        sys.exit(1)
    if not rtf_path.is_file():
        print(f"No existe RTF: {rtf_path}", file=sys.stderr)
        sys.exit(1)

    merged = merge_rows_from_dir(dir_path, args.ultimo_gana)
    if merged["duplicate_skus"] and not args.ultimo_gana:
        print(
            "ERROR: SKUs duplicados entre archivos (use --ultimo-gana o corrija Excel).",
            file=sys.stderr,
        )
        for d in merged["duplicate_skus"][:12]:
            print(f"  {d['sku']}: {d['first']} vs {d['second']}", file=sys.stderr)
        sys.exit(1)

    rows = list(merged["by_sku"].values())
    disambiguate_nombres(rows)
    rows.sort(key=lambda r: (r["categoria"], r["sku"]))

    rtf_bytes = rtf_path.read_bytes()
    try:
        rtf_text = rtf_bytes.decode("utf-8")
    except UnicodeDecodeError:
        rtf_text = rtf_bytes.decode("latin-1")

    precios_map = parse_precios_rtf(
        rtf_text,
        pad5=args.pad_5,
        regla_precios=args.regla_precios,
    )
    by_nombre, by_loose = build_precio_indexes(precios_map)

    print(f"Archivos .xlsx: {len(merged['files'])}", file=sys.stderr)
    for pf in merged["per_file"]:
        print(f"  {pf['file']}: {pf['count']} filas (omitidas {pf['skipped']})", file=sys.stderr)
    print(f"Productos únicos por SKU: {len(rows)}", file=sys.stderr)
    print(f"SKUs con precios parseados en RTF: {len(precios_map)}", file=sys.stderr)

    out_cols = [
        "SKU",
        "Nombre",
        "Existencia",
        "Categoria",
        "Archivo_origen",
        "precioVenta_sin_IVA",
        *[f"lista_{k}_sin_IVA" for k in LIST_KEYS],
        "preciosPorListaCliente_json",
    ]

    sin_rtf_rows: list[list[str]] = []
    matched = matched_sku = matched_nombre = matched_loose = missing = sin_precio_escritos = 0

    buf = io.StringIO(newline="")
    w = csv.writer(buf, lineterminator="\r\n", quoting=csv.QUOTE_MINIMAL)
    w.writerow(out_cols)

    for r in rows:
        p, how = match_row_to_precios(precios_map, by_nombre, by_loose, r["sku"], r["nombre"])
        if not p:
            missing += 1
            sin_rtf_rows.append([r["sku"], r["nombre"], r["sourceFile"]])
            if not args.incluir_sin_precio_rtf:
                continue
            sin_precio_escritos += 1
            rec = {k: 0.0 for k in LIST_KEYS}
            cols_num = [0.0] * len(LIST_KEYS)
            precio_venta = 0.0
        else:
            matched += 1
            if how == "sku":
                matched_sku += 1
            elif how == "nombre":
                matched_nombre += 1
            else:
                matched_loose += 1

            rec = {}
            cols_out: list[str | float] = []
            pv_candidates: list[float] = []
            for k in LIST_KEYS:
                raw = p["preciosConIva"].get(k)
                if raw is None:
                    cols_out.append("")
                    continue
                con = float(raw)
                sin_p = con if args.sin_iva_en_rtf else con_iva_a_sin_iva(con, args.iva)
                rec[k] = sin_p
                cols_out.append(sin_p)
                pv_candidates.append(sin_p)
            precio_venta = float(rec["regular"]) if "regular" in rec else max(pv_candidates) if pv_candidates else 0.0

        w.writerow(
            [
                r["sku"],
                r["nombre"],
                str(int(r["existencia"]) if r["existencia"] == int(r["existencia"]) else r["existencia"]),
                r["categoria"],
                r["sourceFile"],
                str(precio_venta),
                *[str(x) for x in cols_out],
                json.dumps(rec, ensure_ascii=False, separators=(",", ":")),
            ]
        )

    out_path.parent.mkdir(parents=True, exist_ok=True)
    bom = "\ufeff" + buf.getvalue()
    out_path.write_text(bom, encoding="utf-8")

    print(
        f"Filas con precio RTF: {matched} (SKU {matched_sku}, nombre {matched_nombre}, nombre suelto {matched_loose})",
        file=sys.stderr,
    )
    print(f"Sin coincidencia en RTF: {missing}", file=sys.stderr)
    if args.incluir_sin_precio_rtf:
        print(
            f"Incluidas en CSV con precio 0 (sin RTF): {sin_precio_escritos} | Total filas CSV: {matched + sin_precio_escritos}",
            file=sys.stderr,
        )
    print(f"Salida: {out_path}", file=sys.stderr)

    if args.export_sin_rtf and sin_rtf_rows:
        exp = Path(args.export_sin_rtf).expanduser().resolve()
        exp.parent.mkdir(parents=True, exist_ok=True)
        with exp.open("w", encoding="utf-8-sig", newline="") as f:
            ew = csv.writer(f, lineterminator="\r\n")
            ew.writerow(["SKU", "Nombre", "Archivo"])
            ew.writerows(sin_rtf_rows)
        print(f"Export sin RTF: {exp} ({len(sin_rtf_rows)} filas)", file=sys.stderr)


if __name__ == "__main__":
    main()
