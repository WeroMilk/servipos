# Facturama API Web (producción)

Integración PAC para CFDI 4.0 de ingreso, egreso (nota de crédito), complemento de pago y nómina 1.2.

## Secrets (Supabase Edge Functions)

Nunca uses variables `VITE_*` para credenciales Facturama.

```bash
supabase secrets set FACTURAMA_USER="tu_usuario_api"
supabase secrets set FACTURAMA_PASSWORD="tu_password_api"
# Opcional (por defecto producción):
supabase secrets set FACTURAMA_API_BASE="https://api.facturama.mx"
```

CORS: la función `facturama-cfdi` usa `FACTURAMA_CFDI_ALLOWED_ORIGINS` si está definido; si no, reutiliza `ADMIN_CREATE_USER_ALLOWED_ORIGINS` (mismos orígenes que el resto de edges).

```bash
supabase functions deploy facturama-cfdi
```

También aplica la migración de empleados/nómina:

```bash
supabase db push
# o aplica supabase/migrations/20260713200000_employees_nomina_recibos.sql
```

## Checklist previo al primer timbre

1. CSD vigente cargado en el panel Facturama (perfil fiscal del RFC único).
2. Sucursal / lugar de expedición con el mismo CP que en Configuración → Datos fiscales.
3. Folios API disponibles en la suscripción Facturama.
4. En el POS: **desactivar modo prueba fiscal**.
5. RFC / razón social del emisor en Configuración alineados con Facturama.
6. Probar conexión: Configuración → Certificados → «Probar conexión Facturama».

## Flujos en la app

| Flujo | Dónde |
|-------|--------|
| Timbrar / cancelar factura I, nota de crédito E, complemento P | Facturación |
| Complemento al abonar CxC (opcional) | Cuentas por cobrar |
| Empleados + recibos nómina N + timbrar / QR SAT | Nómina |
| Prueba visual sin timbre | Configuración → Nóminas (demo) |

## Permisos

- `facturas:timbrar`, `facturas:cancelar`
- `nominas:ver`, `nominas:crear`, `nominas:timbrar`

Admin y gerente los tienen por defecto. La Edge Function permite admin/gerente o perfiles con permisos fiscales personalizados.
