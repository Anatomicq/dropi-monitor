/**
 * Reintentos con enfriamiento para la API de Dropi (misma lógica adaptativa de
 * dropi-cloud.js): Dropi bloquea temporalmente tras ~100-150 consultas seguidas;
 * sin esto, la mitad de un lote grande sale vacío.
 *
 * consultarUno(id) debe devolver:
 *   { ok: true, dato }                 → éxito (dato puede ser null si no aplica)
 *   { ok: false, permanente: true }    → el producto no existe (no se reintenta)
 *   { ok: false, status, retryAfter }  → fallo temporal (bloqueo) → se reintenta
 */
const PAUSA_MS = 350;
const BLOQUEO_UMBRAL = 4;
const COOLDOWN_INICIAL = 60000;
const COOLDOWN_MAX = 120000;
const MAX_RONDAS = 4;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function consultarLote(ids, consultarUno, log) {
  const res = new Array(ids.length).fill(null);
  const reintentable = (d) => d && !d.ok && !d.permanente;
  let cooldown = COOLDOWN_INICIAL;

  for (let ronda = 1; ronda <= MAX_RONDAS; ronda++) {
    const pend = [];
    for (let i = 0; i < ids.length; i++) if (!res[i] || reintentable(res[i])) pend.push(i);
    if (!pend.length) break;
    if (ronda > 1) log(`Ronda ${ronda}: ${pend.length} por reintentar...`);

    let seguidos = 0, progreso = 0;
    for (let j = 0; j < pend.length; j++) {
      const i = pend[j];
      let d = await consultarUno(ids[i]);
      if (reintentable(d)) {
        seguidos++;
        if (seguidos >= BLOQUEO_UMBRAL) {
          let espera = cooldown;
          if (d.retryAfter) espera = Math.min(d.retryAfter * 1000 + 2000, COOLDOWN_MAX);
          log(`⏸️ Bloqueo de Dropi (HTTP ${d.status || '?'}). Esperando ${Math.round(espera / 1000)}s...`);
          await sleep(espera);
          seguidos = 0;
          d = await consultarUno(ids[i]);
          cooldown = reintentable(d) ? Math.min(Math.round(cooldown * 1.5), COOLDOWN_MAX) : COOLDOWN_INICIAL;
        }
      } else {
        seguidos = 0;
      }
      if (d && d.ok && (!res[i] || !res[i].ok)) progreso++;
      if ((d && d.ok) || !res[i]) res[i] = d;
      if ((j + 1) % 50 === 0) log(`  ${j + 1}/${pend.length}`);
      await sleep(PAUSA_MS);
    }
    const restantes = res.filter((d) => reintentable(d)).length;
    if (restantes) log(`Fin ronda ${ronda}: quedan ${restantes} reintentables.`);
    if (progreso === 0 && restantes) { log('Sin progreso en la ronda; me detengo.'); break; }
  }
  return res;
}

module.exports = { consultarLote };
