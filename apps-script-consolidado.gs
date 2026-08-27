/**
 * HANDLERS PARA PEGAR EN EL Código.gs del Apps Script de la hoja.
 * (Este archivo es solo referencia versionada; el código vive en Google.)
 *
 * En doPost, ANTES del fallback destructivo, agregar el despacho:
 *   if (body.tipo === 'consolidado')            return handleConsolidado(body);
 *   if (body.tipo === 'consolidado_sustitutos') return handleConsolidadoSustitutos(body);
 *
 * Y volver el fallback NO destructivo (solo tipos DESCONOCIDOS): que NO haga
 * sh.clear() sobre "Inventario Dropi"; que devuelva un error explícito.
 * El inventario horario dejará de usar el fallback (pasa a tipo 'consolidado').
 */

// Solo se permite escribir/borrar estas pestañas desde afuera (lista blanca).
var CONSOLIDADO_TABS_OK = ['Auditoría Total', 'Auditoría'];

var COL_ULTIMA = 21;   // A..U = 21 columnas del bloque principal
var SUB_INI = 22;      // primera columna de sustitutos (V)
var SUB_COLS = 12;     // 3 sustitutos x 4 datos
var FILA_TS = 1;       // fila 1: timestamps
var FILA_ENC = 2;      // fila 2: encabezados
var FILA_DATOS = 3;    // datos desde la fila 3

var SUB_HEADERS = [
  'Sustituto 1', 'Proveedor 1', 'ID 1', 'Unidades 1',
  'Sustituto 2', 'Proveedor 2', 'ID 2', 'Unidades 2',
  'Sustituto 3', 'Proveedor 3', 'ID 3', 'Unidades 3'
];

var FILL = { rojo: '#ea9999', naranja: '#f9cb9c', amarillo: '#ffe599', negro: '#000000' };
var RED_CELL = '#e06666';

function _jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function handleConsolidado(body) {
  var tab = String(body.tab || '');
  if (CONSOLIDADO_TABS_OK.indexOf(tab) === -1) {
    return _jsonOut({ ok: false, error: 'tab no permitida: ' + tab });
  }
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(tab) || ss.insertSheet(tab);

  var rows = body.rows || [];
  var colors = body.colors || [];
  var catRed = body.catRed || [];
  var subRed = body.subRed || [];
  var invRed = body.invRed || [];
  var enc = body.encabezados || [];
  var tot = body.totales || {};

  // 1) Snapshot de sustitutos existentes (por ID Dropi en col A) y del ts de sustitutos (B1).
  var subMap = {};
  var tsSub = '';
  var lastRow = sh.getLastRow();
  if (lastRow >= FILA_DATOS) {
    var keys = sh.getRange(FILA_DATOS, 1, lastRow - FILA_DATOS + 1, 1).getValues();
    var subs = sh.getRange(FILA_DATOS, SUB_INI, lastRow - FILA_DATOS + 1, SUB_COLS).getValues();
    for (var i = 0; i < keys.length; i++) {
      var k = String(keys[i][0]);
      if (k) subMap[k] = subs[i];
    }
  }
  if (lastRow >= 1) { var b1 = sh.getRange(FILA_TS, 2).getValue(); if (b1) tsSub = b1; }

  // 2) Limpiar y reescribir.
  sh.clear();
  sh.getRange(FILA_TS, 1).setValue('Actualización general: ' + (body.tsGeneral || ''));
  sh.getRange(FILA_TS, 2).setValue(tsSub || 'Sustitutos: (aún no)');

  var encFull = enc.slice(0, COL_ULTIMA).concat(SUB_HEADERS);
  sh.getRange(FILA_ENC, 1, 1, encFull.length).setValues([encFull]);
  sh.getRange(FILA_ENC, 1, 1, encFull.length).setFontWeight('bold').setBackground('#d9d9d9');

  var n = rows.length;
  if (n > 0) {
    sh.getRange(FILA_DATOS, 1, n, COL_ULTIMA).setValues(rows);
    // Re-adjuntar sustitutos por ID Dropi.
    var reSub = [];
    for (var r = 0; r < n; r++) {
      var key = String(rows[r][0]);
      reSub.push(subMap[key] || new Array(SUB_COLS).fill(''));
    }
    sh.getRange(FILA_DATOS, SUB_INI, n, SUB_COLS).setValues(reSub);

    // Colores por fila.
    for (var r2 = 0; r2 < n; r2++) {
      var fila = sh.getRange(FILA_DATOS + r2, 1, 1, encFull.length);
      var c = colors[r2];
      if (c && FILL[c]) {
        fila.setBackground(FILL[c]);
        if (c === 'negro') fila.setFontColor('#ffffff'); else fila.setFontColor('#000000');
      } else {
        fila.setBackground(null); fila.setFontColor('#000000');
      }
      // Rojos de celda (categoría T=20, subcategoría U=21, inv R=18).
      if (catRed[r2]) sh.getRange(FILA_DATOS + r2, 20).setBackground(RED_CELL);
      if (subRed[r2]) sh.getRange(FILA_DATOS + r2, 21).setBackground(RED_CELL);
      if (invRed[r2]) sh.getRange(FILA_DATOS + r2, 18).setBackground(RED_CELL);
    }
  }

  // 3) Totales, dos filas desde la columna D (col 4), debajo de los datos.
  var filaTot = FILA_DATOS + n + 1;
  var etiquetas = ['# productos', 'En rojo', 'En naranja', 'En amarillo', 'Negro/blanco', 'Rojo/negro en kit', 'Amarillo en kit', 'Archivados'];
  var valores = [tot.nProductos || 0, tot.rojo || 0, tot.naranja || 0, tot.amarillo || 0, tot.negro || 0, tot.rojoNegroEnKit || 0, tot.amarilloEnKit || 0, tot.archivados || 0];
  sh.getRange(filaTot, 4, 1, etiquetas.length).setValues([etiquetas]).setFontWeight('bold');
  sh.getRange(filaTot + 1, 4, 1, valores.length).setValues([valores]);

  SpreadsheetApp.flush();
  return _jsonOut({ ok: true, filas: n, tab: tab });
}

function handleConsolidadoSustitutos(body) {
  var tab = String(body.tab || '');
  if (CONSOLIDADO_TABS_OK.indexOf(tab) === -1) {
    return _jsonOut({ ok: false, error: 'tab no permitida: ' + tab });
  }
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(tab);
  if (!sh) return _jsonOut({ ok: false, error: 'la pestaña no existe todavía: ' + tab });

  // body.sustitutos: { '<dropiId>': [12 valores] }
  var sust = body.sustitutos || {};
  var lastRow = sh.getLastRow();
  if (lastRow < FILA_DATOS) return _jsonOut({ ok: true, filas: 0, nota: 'sin filas de datos' });

  // Encabezados de sustitutos (por si el bloque principal aún no los puso).
  sh.getRange(FILA_ENC, SUB_INI, 1, SUB_COLS).setValues([SUB_HEADERS]).setFontWeight('bold').setBackground('#d9d9d9');

  var keys = sh.getRange(FILA_DATOS, 1, lastRow - FILA_DATOS + 1, 1).getValues();
  var out = [];
  var escritos = 0;
  for (var i = 0; i < keys.length; i++) {
    var k = String(keys[i][0]);
    if (sust[k]) { out.push(sust[k]); escritos++; }
    else out.push(new Array(SUB_COLS).fill(''));
  }
  sh.getRange(FILA_DATOS, SUB_INI, out.length, SUB_COLS).setValues(out);
  sh.getRange(FILA_TS, 2).setValue('Sustitutos: ' + (body.tsSustitutos || ''));

  SpreadsheetApp.flush();
  return _jsonOut({ ok: true, filas: escritos });
}
