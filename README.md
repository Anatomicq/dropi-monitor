# Dropi Monitor (nube)

Agente que consulta el inventario en Dropi 3 veces al día (8am, 4pm, 8pm hora Colombia)
y lo escribe en una hoja de Google Sheets vía un Apps Script "web app".

- `dropi-cloud.js` — login + consulta de productos (HTTP, sin navegador) + envío a la hoja.
- `productos.json` — lista de productos a monitorear.
- `.github/workflows/dropi.yml` — programación en GitHub Actions.

## Secretos requeridos (Settings → Secrets and variables → Actions)
- `DROPI_EMAIL`, `DROPI_PASSWORD` — credenciales de Dropi.
- `SHEETS_WEBAPP_URL` — URL `/exec` del Apps Script que escribe la hoja.
- `SHEETS_SECRET` — token compartido con ese Apps Script.
