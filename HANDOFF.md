# Traspaso / Documentación — Agente Dropi → Google Sheets

Documento para que otra persona (con Claude Code) pueda entender y modificar todo lo construido.

## ¿Qué hace esto?
Consulta el inventario de **Dropi** (307 productos) **3 veces al día (8am, 1pm, 6pm hora Colombia)**
y escribe el resultado en una **hoja de Google Sheets**, con colores por stock.

## Arquitectura (cómo fluye)
```
GitHub Actions (cron 3x/día)
      │  corre  dropi-cloud.js  (Node, sin navegador)
      ▼
1) Login a Dropi por HTTP  →  api-v2.dropi.co/bff/auth/core/login  (devuelve token)
2) Consulta cada producto  →  api.dropi.co/api/products/productlist/v1/show/?id=...
      │  (con headers de navegador: User-Agent + sec-ch-ua + Origin, si no da 403)
      ▼
3) POST del resultado  →  Apps Script "web app" (relay) que vive en la hoja
      ▼
Google Sheet: pestaña "Inventario Dropi" (con colores) + pestaña "Resumen"
```

## Dónde vive cada cosa
| Pieza | Ubicación | ¿En este repo? |
|---|---|---|
| Agente de la nube | `dropi-cloud.js` | ✅ Sí |
| Lista de productos | `productos.json` | ✅ Sí |
| Programación (cron) | `.github/workflows/dropi.yml` | ✅ Sí |
| **Secretos** (credenciales, URL, token) | GitHub → Settings → Secrets → Actions | ❌ No (cifrados) |
| **Receptor** que escribe la hoja (Apps Script) | Dentro de la Google Sheet → Extensiones → Apps Script | ❌ No (vive en Google) |
| Respaldo local (Puppeteer) | `monitor.js` en el PC original (`D:\dropi-monitor`) | ❌ No (solo local) |

## Secretos (GitHub → Settings → Secrets and variables → Actions)
- `DROPI_EMAIL`, `DROPI_PASSWORD` — login de Dropi.
- `SHEETS_WEBAPP_URL` — URL `/exec` del Apps Script relay.
- `SHEETS_SECRET` — token compartido con el relay (debe coincidir con la constante `SECRET` del Apps Script).
> Los valores de los secrets NO se pueden leer una vez guardados; solo sobrescribir.

## La Google Sheet
- ID: `1BkRziMKhQlp0Hw5fxNTzPeU4xpvwityEs1cBNONylXg`
- Pestañas que escribe el relay: **"Inventario Dropi"** (datos + colores) y **"Resumen"** (fecha/hora + totales).
- El relay (Apps Script) hace: recibir POST → validar el token → limpiar la pestaña → escribir → aplicar
  formato condicional en la columna Stock (rojo=0, amarillo=1–10, verde>10) + encabezado morado.

## Cómo hacer cambios comunes
- **Cambiar horarios:** edita `.github/workflows/dropi.yml` (cron en UTC; Colombia = UTC−5). Haz commit + push.
- **Cambiar la lógica de consulta:** edita `dropi-cloud.js`. Haz commit + push.
- **Correr manualmente:** GitHub → pestaña **Actions** → "Dropi Monitor" → **Run workflow**.
- **Cambiar la lista de productos:** edita `productos.json` (cada item: `{dropiId, sku, titulo, shopifyStatus}`).
- **Cambiar colores / formato de la hoja:** editar el Apps Script (relay) dentro de la Sheet y **republicar**
  (Implementar → Gestionar implementaciones → editar ✏️ → Versión nueva → misma URL).

## Comportamientos importantes que ya se resolvieron
1. **Dropi bloquea por headers, no por IP:** la API de producto exige User-Agent de navegador + client-hints;
   si no, responde `403 Access denied`. Ya están puestos en `apiHeaders()` de `dropi-cloud.js`.
   (Por eso NO se puede hacer "todo en Google Apps Script": UrlFetchApp no deja cambiar el User-Agent.)
2. **Límite de velocidad (rate limit):** si se consulta muy rápido/concurrente, Dropi bloquea temporalmente.
   Por eso `dropi-cloud.js` va **secuencial (350ms)** con detección de bloqueo (espera 90s) y
   **reintentos por rondas**. Termina con solo los que de verdad no existen (~3).
3. **Productos con variantes (tallas/colores):** el padre trae `stock: null`; el stock real está en
   `objects.variations[].stock`. `consultar()` **suma las variantes** cuando `type === "VARIABLE"`.

## Estado / pendientes conocidos
- GitHub Actions tuvo una caída general el 2026-08-06 que impidió validar la primera corrida en la nube.
  La config es correcta; los cron corren solos cuando el servicio esté normal. Validar con "Run workflow".
- En el PC original hay 3 tareas de Windows (8am/1pm/6pm) como respaldo que corren `dropi-cloud.js`.
  Se pueden borrar (`schtasks /Delete`) si ya no se quiere el respaldo local.
