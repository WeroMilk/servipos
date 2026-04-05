# Importar inventario real Olivares (Excel + lista RTF)

El script **`npm run import:olivares-to-supabase`** lee **todos los `.xlsx`** de una carpeta (cada archivo = una categoría, nombre de hoja = primera hoja) y cruza precios con **`lista de precios.rtf`**.

## Reglas de precios (RTF, 5 precios **con IVA**)

La lógica está en `scripts/lib/olivaresRtfPrecios.mjs` (`mapFiveConIvaPricesToLists`):

| Lista en la app | Regla |
|-----------------|--------|
| **Cananea** | El que tiene **centavos** (ej. `$22.45`). Si hay varios con centavos, el **menor**. Si ninguno tiene centavos, el **menor** de los cinco. |
| **Regular** | El **más caro** de los cuatro restantes (sin Cananea). |
| **Técnico** | El que **sigue** al regular (segundo más caro). |
| **Mayoreo −** | El **segundo más barato** (antepenúltimo al ordenar de mayor a menor). |
| **Mayoreo +** | El **más barato**. |

En base de datos se guardan **sin IVA** (`preciosListaIncluyenIva: false`), según `--iva=16` (por defecto).

## Requisitos

- `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` en el entorno, o en `.env` / `.env.local` (véase `import-csv-precios-olivares-to-supabase.mjs`).
- La **service_role**, no la clave anon.

## Credenciales (una vez)

En la **raíz del repo**, archivo **`.env.local`** (gitignored), una sola línea **sin espacio** después del `=`:

```env
SUPABASE_SERVICE_ROLE_KEY=pegue_aqui_la_clave_service_role_de_Supabase_Dashboard_Settings_API
```

`SUPABASE_URL` no es obligatorio si ya tiene `VITE_SUPABASE_URL` en `.env` (el script lo reutiliza).

## Comando listo para copiar y pegar

**Git Bash** (una línea):

```bash
cd ~/proyectos/SERVIpos && npm run import:olivares-to-supabase -- --dir="/c/Users/alfon/Downloads/inventario abril 2026 servipartz olivares" --rtf="/c/Users/alfon/Downloads/lista de precios.rtf" --sucursal=olivares --ultimo-gana
```

**PowerShell**:

```powershell
cd $HOME\proyectos\SERVIpos; npm run import:olivares-to-supabase -- --dir="C:\Users\alfon\Downloads\inventario abril 2026 servipartz olivares" --rtf="C:\Users\alfon\Downloads\lista de precios.rtf" --sucursal=olivares --ultimo-gana
```

**Git Bash** (varias líneas con `\`):

```bash
npm run import:olivares-to-supabase -- \
  --dir="/c/Users/alfon/Downloads/inventario abril 2026 servipartz olivares" \
  --rtf="/c/Users/alfon/Downloads/lista de precios.rtf" \
  --sucursal=olivares \
  --ultimo-gana
```

### Opciones útiles

| Flag | Uso |
|------|-----|
| `--ultimo-gana` | Si el mismo **SKU** aparece en varios Excel, queda la **última** archivo alfabético. Sin esto, el script **falla** si hay duplicados. |
| `--dry-run` | No escribe en Supabase; solo muestra estadísticas. |
| `--strict-precios` | Falla si algún producto del Excel **no** tiene match en el RTF. |
| `--export-sin-rtf=./data/sin-precio-rtf.csv` | Genera CSV con SKU, nombre y archivo `.xlsx` de filas **sin** precio en el RTF (para revisar o ampliar la lista Crystal). |
| `--iva=16` | IVA porcentaje al convertir RTF con IVA → sin IVA. |
| `--sucursal-nombre=Olivares` | Texto para crear fila en `public.sucursales` si el id no existe. |

## Columnas esperadas en cada `.xlsx`

El lector busca columnas por nombre flexible (ver `INVENTORY_ALIASES` en `scripts/lib/olivaresInventoryFromDir.mjs`):

- **Código / SKU:** `codigo`, `código`, `sku`, `clave`
- **Nombre / descripción:** `descripcion`, `nombre`, `producto`
- **Existencia:** `actual`, `existencia`, `stock`

## Después del import

1. En la app, sucursal **olivares** y revisar **Inventario**.
2. Si faltan precios: algunos SKUs no matchean el RTF; el script lista “sin coincidencia en RTF” en stderr.

## Nota

No suba la **service_role** a Git ni a Vercel. Solo en `.env.local` (gitignored) o en su máquina.
