/**
 * Construye la pestaña CONSOLIDADA "Auditoría" (base madre = Shopify).
 * Junta lo que hoy son Resumen + Alertas Proveedor + Auditoría + Inventario Dropi
 * (+ Sustitutos, que llegan por su propio camino de 5am).
 *
 * NO consulta nada por su cuenta: recibe `productos` (de obtener-productos-shopify,
 * ya con precio/inv/colecciones/variantsCount/esComponente) y `datos` (de la
 * consulta a Dropi de dropi-cloud, ya con stock/privado/privOtros/proveedor...).
 *
 * Columnas A-U (las de sustitutos V+ las escribe el job de 5am, sin pisarse):
 *   A ID Dropi | B SKU | C Producto Shopify | D Nombre Dropi | E Stock publico |
 *   F Priv. nuestro | G Priv. de otros | H Activo | I Archivado | J Estado Shopify |
 *   K Proveedor | L Bodega | M WhatsApp(link) | N Ciudad | O Precio Dropi |
 *   P Utilidad | Q En kit | R Inv Dropi/Shopify | S Variable/Simple |
 *   T Categoria | U Subcategoria
 */

// Mapa del inicio (mismo que auditoria.js): categoria madre -> subcategorias.
const CATEGORIAS = {
  'skincare': { nombre: 'PIEL Y BELLEZA', subs: ['envejecimiento-facial-arrugas-flacidez-papada-ojeras','manchas-e-hiperpigmentacion','piel-seca-e-hidratacion','acne-poros-y-piel-grasa','cuidado-corporal-y-detalles-vello-unas-venas-callos','celulitis-flacidez-corporal-y-estrias','salud-dental-y-sonrisa'] },
  'capilar': { nombre: 'CAPILAR', subs: ['tratamiento-capilar','herramientas-de-estilizado'] },
  'control-de-peso': { nombre: 'PESO Y METABOLISMO', subs: ['sobrepeso-y-quema-de-grasa','digestion-hinchazon-y-detox','salud-hormonal-femenina','salud-hormonal-masculina-y-vitalidad'] },
  'fitness-en-casa': { nombre: 'FITNESS Y RENDIMIENTO', subs: ['fuerza','cardiovascular','suplementos-y-proteinas','flexibilidad'] },
  'recuperacion-muscular': { nombre: 'DOLOR Y MOVILIDAD', subs: ['migrana-dolor-de-cabeza','cuello-y-cervical','articular-rodilla-hombro-codo-tobillo-y-rigidez','espalda-lumbar-y-postura','manos-dedos-y-muneca','muscular-post-ejercicio-y-calambres','medicion-y-monitoreo-de-salud','circulacion-y-piernas-cansadas'] },
  'sueno-y-descanso': { nombre: 'SUENO Y CALMA', subs: ['insomnio-mal-sueno','ansiedad-y-estres','ronquidos','ambiente-y-relajacion'] },
};
function subAMadre() { const m = {}; for (const [cat, v] of Object.entries(CATEGORIAS)) for (const s of v.subs) m[s] = cat; return m; }
const S2M = subAMadre();

function normalizarTelefonoCO(tel) {
  let n = String(tel || '').replace(/[^\d]/g, '');
  if (!n) return '';
  if (n.startsWith('57') && n.length >= 12) return n;
  n = n.replace(/^0+/, '');
  if (n.length === 10) return '57' + n;
  if (n.length >= 12 && n.startsWith('57')) return n;
  return n.length >= 10 ? '57' + n.slice(-10) : '';
}

const ENCABEZADOS = ['ID Dropi','SKU','Producto Shopify','Nombre Dropi','Stock publico',
  'Priv. nuestro','Priv. de otros','Activo','Archivado','Estado Shopify','Proveedor',
  'Bodega','WhatsApp','Ciudad','Precio Dropi','Utilidad','En kit','Inv Dropi/Shopify',
  'Variable/Simple','Categoria','Subcategoria'];

// Nombre corto del producto (lo que va tras el ultimo " - ").
const corto = (t) => String(t || '').split(' - ').slice(-1)[0].slice(0, 60);

function colorFila(prod, d) {
  if (!d || !d.existe) return 'negro';    // no existe en Dropi
  if (d.archivado) return 'morado';       // archivado (el proveedor no despacha) - problema distinto al agotado
  const e = Number(d.stock) || 0;
  if (e === 0) return 'rojo';      // agotado (0)
  if (e < 50) return 'amarillo';   // literal: 1-49
  if (e < 99) return 'naranja';    // literal: 50-98
  return '';
}

// Orden de aparición (severidad para el usuario): negro > morado > rojo > naranja > amarillo > sin color.
const PRIORIDAD = { negro: 0, morado: 1, rojo: 2, naranja: 3, amarillo: 4, '': 5 };

function categoriaSub(prod) {
  // Los componentes/bases de pack estan ocultos a proposito: no exigen categoria.
  if (prod.esComponente) return { cat: '(componente)', sub: '(componente)', catOK: true, subOK: true };
  const madres = (prod.colecciones || []).filter((c) => CATEGORIAS[c]);
  const subs = (prod.colecciones || []).filter((c) => S2M[c]);
  const cat = madres.length ? madres.map((m) => CATEGORIAS[m].nombre).join(', ') : 'NO';
  const sub = subs.length ? subs.join(', ') : 'NO';
  return { cat, sub, catOK: madres.length > 0, subOK: subs.length > 0 };
}

function filaConsolidada(prod, d) {
  const existe = d && d.existe;
  const eStock = existe ? (Number(d.stock) || 0) : '-';
  const tel = existe ? normalizarTelefonoCO(d.telefono) : '';
  const nombre = corto(prod.titulo);
  const msg = 'Hola, escribo de ANATOMICQ sobre el producto "' + nombre + '" (Dropi ' + prod.dropiId + '). Queria consultar por disponibilidad/stock. Gracias!';
  const wa = tel ? ('https://wa.me/' + tel + '?text=' + encodeURIComponent(msg)) : '';
  const costo = existe ? (Number(d.precioBase) || 0) : 0;
  const utilidad = (Number(prod.precio) || 0) - costo;
  const invCmp = existe ? ((Number(d.stock) || 0) + '/' + (Number(prod.invShopify) || 0)) : ('-/' + (Number(prod.invShopify) || 0));
  const varSimple = existe ? (d.esVariable ? 'Variable' : 'Simple') : '-';
  const cs = categoriaSub(prod);
  const estado = (prod.esBasePack && prod.shopifyStatus === 'draft') ? 'base de pack (OK)' : prod.shopifyStatus;

  return [
    prod.dropiId,                                   // A
    prod.sku,                                       // B
    prod.titulo,                                    // C
    existe ? d.nombre : '-',                        // D
    eStock,                                         // E
    existe ? (Number(d.stockPrivado) || 0) : 0,     // F
    existe ? (Number(d.privOtros) || 0) : 0,        // G
    existe ? (d.activo ? 'Si' : 'No') : '-',        // H
    existe ? (d.archivado ? 'Si' : 'No') : '-',     // I
    estado,                                         // J
    existe ? d.proveedor : '-',                     // K
    existe ? d.bodega : '-',                        // L
    wa,                                             // M
    existe ? d.ciudad : '-',                        // N
    costo,                                          // O
    utilidad,                                       // P
    prod.esComponente ? 'Si' : 'No',                // Q
    invCmp,                                         // R
    varSimple,                                      // S
    cs.cat,                                         // T
    cs.sub,                                         // U
  ];
}

// dif > 20% entre Dropi y Shopify -> marcar R en rojo.
function invDesalineado(prod, d) {
  if (!d || !d.existe) return false;
  const dr = Number(d.stock) || 0, sh = Number(prod.invShopify) || 0;
  const base = Math.max(dr, sh);
  if (base === 0) return false;
  return Math.abs(dr - sh) / base > 0.20;
}

function construirConsolidado(productos, datos) {
  // 1) armar registros con su color y ORDENAR por severidad (color primero).
  const regs = [];
  for (let i = 0; i < productos.length; i++) {
    const prod = productos[i], d = datos[i];
    const c = colorFila(prod, d);
    const cs = categoriaSub(prod);
    regs.push({ prod, d, color: c, catRed: !cs.catOK, subRed: !cs.subOK, invRed: invDesalineado(prod, d) });
  }
  regs.sort((a, b) => (PRIORIDAD[a.color] - PRIORIDAD[b.color]));

  // 2) construir arrays ya ordenados + totales.
  const filas = [], colors = [], catRed = [], subRed = [], invRed = [];
  const t = { nProductos: 0, negro: 0, morado: 0, rojo: 0, naranja: 0, amarillo: 0, problemaEnKit: 0, amarilloEnKit: 0, archivados: 0 };
  for (const r of regs) {
    filas.push(filaConsolidada(r.prod, r.d));
    colors.push(r.color);
    catRed.push(r.catRed);
    subRed.push(r.subRed);
    invRed.push(r.invRed);
    t.nProductos++;
    if (r.color === 'negro') t.negro++;
    if (r.color === 'morado') t.morado++;
    if (r.color === 'rojo') t.rojo++;
    if (r.color === 'naranja') t.naranja++;
    if (r.color === 'amarillo') t.amarillo++;
    if ((r.color === 'negro' || r.color === 'morado' || r.color === 'rojo') && r.prod.esComponente) t.problemaEnKit++;
    if (r.color === 'amarillo' && r.prod.esComponente) t.amarilloEnKit++;
    if (r.d && r.d.existe && r.d.archivado) t.archivados++;
  }
  return { encabezados: ENCABEZADOS, filas, colors, catRed, subRed, invRed, totales: t };
}

async function enviarConsolidado(webapp, secret, tab, cons, tsGeneral) {
  const payload = JSON.stringify({
    secret, tipo: 'consolidado', tab, tsGeneral,
    encabezados: cons.encabezados, rows: cons.filas, colors: cons.colors,
    catRed: cons.catRed, subRed: cons.subRed, invRed: cons.invRed, totales: cons.totales,
  });
  for (let intento = 1; intento <= 3; intento++) {
    try {
      const r = await fetch(webapp, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, redirect: 'follow' });
      const txt = await r.text();
      let ok = false; try { ok = JSON.parse(txt).ok; } catch {}
      if (ok) return true;
      console.log('[consolidado] intento ' + intento + ': respuesta inesperada: ' + txt.slice(0, 120).replace(/\s+/g, ' '));
    } catch (e) { console.log('[consolidado] intento ' + intento + ': error de red: ' + e.message); }
    await new Promise((r) => setTimeout(r, 4000));
  }
  return false;
}

module.exports = { construirConsolidado, enviarConsolidado, CATEGORIAS, ENCABEZADOS };
