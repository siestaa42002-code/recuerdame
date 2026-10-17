// Función programada: corre cada hora (minuto 0) y envía los avisos que
// correspondan a la hora actual de Colombia para cada usuario.
//
//  - A la "hora de avisos diarios" del usuario: recordatorios cuya anticipación
//    coincide con hoy (30, 15, 7, 1, 0 días) y, si aplica, "hoy tienes pico y placa".
//  - A la "hora de la noche anterior": "mañana tienes pico y placa".
//
// Cada aviso se marca en users/{uid}.enviados para no repetirlo si la función
// corre dos veces en la misma hora.

import { admin, enviarAUsuario } from "./_lib/admin.mjs";
import {
  ahoraColombia, proximaFecha, diasEntre, sumarDias, tienePicoYPlaca,
  normalizarRotacion, fechaLarga, NOMBRES_DIA, diaSemana
} from "../../js/pico-y-placa.js";
import rotacionAuto from "../../data/pico-y-placa.json";

const ETIQUETA_CAT = { documento: "Documento", fecha: "Fecha importante", pago: "Pago", otro: "Recordatorio" };

export default async (req) => {
  const forzar = new URL(req.url).searchParams.get("forzar"); // ?forzar=HH para pruebas manuales
  const { db, messaging } = admin();
  const { iso: hoy, hora: horaReal } = ahoraColombia();
  const hora = forzar !== null && forzar !== "" ? Number(forzar) : horaReal;
  const manana = sumarDias(hoy, 1);

  const usuarios = await db.collection("users").get();
  let totalEnviados = 0;
  const resumen = [];

  for (const docU of usuarios.docs) {
    const u = docU.data();
    const uid = docU.id;
    if (u.notifGlobal === false) continue;
    if (!u.tokens || !Object.keys(u.tokens).length) continue;

    const horaAviso = Number(u.horaAviso ?? 7);
    const horaNoche = Number(u.horaNoche ?? 20);
    const categorias = u.categorias || {};
    const pyp = u.pyp || {};
    const enviados = u.enviados || {};
    const nuevosEnviados = {};
    const pendientes = []; // { key, title, body, tag }

    // ----- Recordatorios -----
    if (hora === horaAviso) {
      const snap = await db.collection("users").doc(uid).collection("recordatorios").get();
      for (const d of snap.docs) {
        const r = d.data();
        if (r.activo === false) continue;
        if (categorias[r.categoria] === false) continue;
        if (!r.fecha) continue;

        const proxima = proximaFecha(r.fecha, !!r.anual, hoy);
        const dias = diasEntre(hoy, proxima);
        const avisos = Array.isArray(r.avisos) && r.avisos.length ? r.avisos.map(Number) : [0];

        let body = null;
        if (avisos.includes(dias)) {
          body = dias === 0 ? `Es hoy (${fechaLarga(proxima)}).`
            : dias === 1 ? `Es mañana, ${fechaLarga(proxima)}.`
            : `Faltan ${dias} días (${fechaLarga(proxima)}).`;
        } else if (!r.anual && dias < 0 && dias >= -3) {
          body = `Venció hace ${-dias} día${dias === -1 ? "" : "s"} (${fechaLarga(proxima)}).`;
        }
        if (!body) continue;
        if (r.notas) body += ` ${String(r.notas).slice(0, 80)}`;

        pendientes.push({
          key: `rec:${d.id}:${proxima}:${dias}`,
          title: `${ETIQUETA_CAT[r.categoria] || "Recordatorio"}: ${r.titulo}`,
          body,
          tag: `rec-${d.id}`
        });
      }
    }

    // ----- Pico y placa -----
    if (pyp.activo && pyp.placa) {
      const rotacion = normalizarRotacion(pyp.rotacionPersonalizada) || normalizarRotacion(rotacionAuto.rotacion);
      const cfg = { placa: pyp.placa, tipo: pyp.tipo || "carro", rotacion, ignorarFestivos: pyp.ignorarFestivos !== false };
      const horario = rotacionAuto.horario || "de 5:00 a. m. a 8:00 p. m.";

      if (hora === horaAviso && pyp.manana !== false && tienePicoYPlaca(hoy, cfg)) {
        pendientes.push({
          key: `pyp:hoy:${hoy}`,
          title: `Hoy tienes pico y placa (${pyp.placa})`,
          body: `${capitalizar(NOMBRES_DIA[diaSemana(hoy)])}: restricción ${horario.toLowerCase().replace(/^lunes a viernes /, "")}.`,
          tag: "pyp-hoy"
        });
      }
      if (hora === horaNoche && pyp.noche !== false && tienePicoYPlaca(manana, cfg)) {
        pendientes.push({
          key: `pyp:manana:${manana}`,
          title: `Mañana tienes pico y placa (${pyp.placa})`,
          body: `${capitalizar(NOMBRES_DIA[diaSemana(manana)])} desde las 5:00 a. m. Organiza el transporte desde ahora.`,
          tag: "pyp-manana"
        });
      }
    }

    // ----- Envío con deduplicación -----
    for (const p of pendientes) {
      if (enviados[p.key]) continue;
      const n = await enviarAUsuario({ db, messaging }, uid, u.tokens, { title: p.title, body: p.body, tag: p.tag });
      totalEnviados += n;
      nuevosEnviados[p.key] = hoy;
      resumen.push({ uid, key: p.key, enviados: n });
    }

    // Guardar marcas y podar las de hace más de 60 días.
    const limpio = {};
    for (const [k, v] of Object.entries(enviados)) {
      if (typeof v === "string" && diasEntre(v, hoy) <= 60) limpio[k] = v;
    }
    const final = { ...limpio, ...nuevosEnviados };
    if (Object.keys(nuevosEnviados).length || Object.keys(final).length !== Object.keys(enviados).length) {
      await db.collection("users").doc(uid).update({ enviados: final }).catch(() => {});
    }
  }

  const salida = { hoy, hora, usuarios: usuarios.size, notificaciones: totalEnviados, detalle: resumen };
  console.log(JSON.stringify(salida));
  return new Response(JSON.stringify(salida), { headers: { "Content-Type": "application/json" } });
};

function capitalizar(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const config = {
  schedule: "@hourly"
};
