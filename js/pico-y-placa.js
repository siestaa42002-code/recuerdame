// Lógica pura de fechas, festivos y pico y placa.
// La usan tanto el navegador (app.js) como la función de Netlify,
// por eso no toca el DOM ni Firebase.

// ---------- Fechas (siempre como "YYYY-MM-DD", sin zona horaria) ----------

export function partesFecha(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d };
}

export function aIso(y, m, d) {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Día de la semana: 0 = domingo ... 6 = sábado. */
export function diaSemana(iso) {
  const { y, m, d } = partesFecha(iso);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function sumarDias(iso, n) {
  const { y, m, d } = partesFecha(iso);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return aIso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

export function diasEntre(desdeIso, hastaIso) {
  const a = partesFecha(desdeIso), b = partesFecha(hastaIso);
  const ms = Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d);
  return Math.round(ms / 86400000);
}

/** Fecha y hora actual en Colombia (UTC-5 fijo, sin horario de verano). */
export function ahoraColombia(ahora = new Date()) {
  const t = new Date(ahora.getTime() - 5 * 3600000);
  return {
    iso: aIso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()),
    hora: t.getUTCHours(),
    minuto: t.getUTCMinutes()
  };
}

/**
 * Próxima ocurrencia de un recordatorio.
 * Si es anual y la fecha ya pasó este año, devuelve la del año siguiente.
 */
export function proximaFecha(fechaIso, anual, hoyIso) {
  if (!anual) return fechaIso;
  const { m, d } = partesFecha(fechaIso);
  const { y } = partesFecha(hoyIso);
  let candidata = aIso(y, m, d);
  if (m === 2 && d === 29 && !esBisiesto(y)) candidata = aIso(y, 2, 28);
  if (diasEntre(hoyIso, candidata) < 0) {
    const y2 = y + 1;
    candidata = (m === 2 && d === 29 && !esBisiesto(y2)) ? aIso(y2, 2, 28) : aIso(y2, m, d);
  }
  return candidata;
}

function esBisiesto(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

// ---------- Festivos de Colombia (Ley 51 de 1983, "Ley Emiliani") ----------

function pascua(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return aIso(y, mes, dia);
}

function siguienteLunes(iso) {
  const dow = diaSemana(iso);
  return dow === 1 ? iso : sumarDias(iso, (8 - dow) % 7);
}

const festivosCache = new Map();

/** Lista de festivos (ISO) de un año. */
export function festivosColombia(y) {
  if (festivosCache.has(y)) return festivosCache.get(y);
  const fijos = [[1, 1], [5, 1], [7, 20], [8, 7], [12, 8], [12, 25]].map(([m, d]) => aIso(y, m, d));
  const aLunes = [[1, 6], [3, 19], [6, 29], [8, 15], [10, 12], [11, 1], [11, 11]].map(([m, d]) => siguienteLunes(aIso(y, m, d)));
  const p = pascua(y);
  const relativos = [
    sumarDias(p, -3),              // Jueves Santo
    sumarDias(p, -2),              // Viernes Santo
    siguienteLunes(sumarDias(p, 39)), // Ascensión
    siguienteLunes(sumarDias(p, 60)), // Corpus Christi
    siguienteLunes(sumarDias(p, 68))  // Sagrado Corazón
  ];
  const todos = new Set([...fijos, ...aLunes, ...relativos]);
  festivosCache.set(y, todos);
  return todos;
}

export function esFestivo(iso) {
  return festivosColombia(partesFecha(iso).y).has(iso);
}

// ---------- Pico y placa ----------

/** Dígito relevante de la placa según el tipo de vehículo. */
export function digitoPlaca(placa, tipo) {
  const digitos = String(placa || "").replace(/\D/g, "");
  if (!digitos) return null;
  return Number(tipo === "moto" ? digitos[0] : digitos[digitos.length - 1]);
}

/**
 * Normaliza una rotación. Acepta { "1": [5,8], ... } con claves 1..5
 * (lunes..viernes). Devuelve null si no hay nada utilizable.
 */
export function normalizarRotacion(rot) {
  if (!rot || typeof rot !== "object") return null;
  const salida = {};
  let alguna = false;
  for (let dia = 1; dia <= 5; dia++) {
    const v = rot[dia] ?? rot[String(dia)];
    if (Array.isArray(v) && v.length) {
      salida[dia] = v.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 9);
      alguna = alguna || salida[dia].length > 0;
    } else {
      salida[dia] = [];
    }
  }
  return alguna ? salida : null;
}

/**
 * ¿Tiene pico y placa en la fecha dada?
 * cfg: { placa, tipo, rotacion, ignorarFestivos }
 */
export function tienePicoYPlaca(iso, cfg) {
  const rot = normalizarRotacion(cfg.rotacion);
  const digito = digitoPlaca(cfg.placa, cfg.tipo);
  if (!rot || digito === null) return false;
  const dow = diaSemana(iso);
  if (dow === 0 || dow === 6) return false;
  if (cfg.ignorarFestivos !== false && esFestivo(iso)) return false;
  return rot[dow].includes(digito);
}

/** Dígitos restringidos en la fecha (vacío en fin de semana o festivo). */
export function digitosDelDia(iso, rotacion, ignorarFestivos = true) {
  const rot = normalizarRotacion(rotacion);
  if (!rot) return [];
  const dow = diaSemana(iso);
  if (dow === 0 || dow === 6) return [];
  if (ignorarFestivos && esFestivo(iso)) return [];
  return rot[dow];
}

export const NOMBRES_DIA = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
export const NOMBRES_MES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export function fechaLarga(iso) {
  const { y, m, d } = partesFecha(iso);
  return `${NOMBRES_DIA[diaSemana(iso)]} ${d} de ${NOMBRES_MES[m - 1]} de ${y}`;
}

export function fechaCorta(iso) {
  const { m, d } = partesFecha(iso);
  return `${d} ${NOMBRES_MES[m - 1].slice(0, 3)}`;
}
