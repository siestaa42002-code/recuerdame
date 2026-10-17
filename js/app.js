import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
  onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, collection, getDoc, setDoc, updateDoc, addDoc, deleteDoc,
  onSnapshot, query, orderBy, serverTimestamp, deleteField, FieldPath
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getMessaging, getToken, onMessage, isSupported } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js";

import { firebaseConfig, vapidKey } from "./firebase-config.js";
import {
  ahoraColombia, proximaFecha, diasEntre, sumarDias, tienePicoYPlaca, digitosDelDia,
  digitoPlaca, normalizarRotacion, fechaLarga, fechaCorta, NOMBRES_DIA
} from "./pico-y-placa.js";

// ---------- Firebase ----------
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
let messaging = null;

// ---------- Estado ----------
const estado = {
  uid: null,
  usuario: null,        // documento users/{uid}
  recordatorios: [],    // lista en memoria
  rotacionAuto: null,   // data/pico-y-placa.json
  filtro: "todas",
  tab: "inicio",
  swReg: null,
  tokenActual: null,
  desuscribirUsuario: null,
  desuscribirLista: null
};

const AJUSTES_POR_DEFECTO = {
  notifGlobal: true,
  horaAviso: 7,
  horaNoche: 20,
  categorias: { documento: true, fecha: true, pago: true, otro: true },
  pyp: {
    activo: false, placa: "", tipo: "carro",
    noche: true, manana: true, ignorarFestivos: true,
    rotacionPersonalizada: null
  }
};

const ETIQUETA_CAT = { documento: "Documento", fecha: "Fecha", pago: "Pago", otro: "Otro" };

// ---------- Utilidades DOM ----------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

let toastTimer = null;
function toast(msg, ms = 2600) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.remove("oculto");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("oculto"), ms);
}

function mezclarAjustes(datos) {
  const d = datos || {};
  return {
    ...AJUSTES_POR_DEFECTO,
    ...d,
    categorias: { ...AJUSTES_POR_DEFECTO.categorias, ...(d.categorias || {}) },
    pyp: { ...AJUSTES_POR_DEFECTO.pyp, ...(d.pyp || {}) }
  };
}

// ---------- Rotación automática ----------
async function cargarRotacionAuto() {
  try {
    const res = await fetch("/data/pico-y-placa.json", { cache: "no-cache" });
    const json = await res.json();
    estado.rotacionAuto = json;
  } catch (e) {
    console.warn("No se pudo cargar la rotación automática", e);
  }
}

function rotacionVigente() {
  const p = estado.usuario?.pyp;
  const personalizada = normalizarRotacion(p?.rotacionPersonalizada);
  if (personalizada) return { rotacion: personalizada, origen: "personalizada" };
  const auto = normalizarRotacion(estado.rotacionAuto?.rotacion);
  return { rotacion: auto, origen: "automática" };
}

// ---------- Autenticación ----------
const proveedor = new GoogleAuthProvider();

$("#btn-login").addEventListener("click", async () => {
  $("#login-error").classList.add("oculto");
  try {
    await signInWithPopup(auth, proveedor);
  } catch (e) {
    // En PWA instalada o navegadores que bloquean popups, usar redirección.
    if (["auth/popup-blocked", "auth/operation-not-supported-in-this-environment", "auth/cancelled-popup-request"].includes(e.code)) {
      await signInWithRedirect(auth, proveedor);
    } else if (e.code !== "auth/popup-closed-by-user") {
      $("#login-error").textContent = "No se pudo iniciar sesión: " + (e.message || e.code);
      $("#login-error").classList.remove("oculto");
    }
  }
});

$("#btn-logout").addEventListener("click", async () => {
  if (estado.tokenActual && estado.uid) {
    // Quitar el token de este dispositivo para que no sigan llegando avisos aquí.
    // Los tokens tienen caracteres como ":" que rompen las rutas con punto; por eso FieldPath.
    try { await updateDoc(doc(db, "users", estado.uid), new FieldPath("tokens", estado.tokenActual), deleteField()); } catch (_) {}
  }
  await signOut(auth);
});

getRedirectResult(auth).catch(() => {});

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    limpiarSesion();
    $("#vista-app").classList.add("oculto");
    $("#vista-login").classList.remove("oculto");
    return;
  }
  estado.uid = user.uid;
  $("#usuario-nombre").textContent = user.displayName || user.email || "";
  $("#vista-login").classList.add("oculto");
  $("#vista-app").classList.remove("oculto");

  await asegurarDocumentoUsuario(user);
  suscribirUsuario();
  suscribirRecordatorios();
  prepararNotificaciones();
});

function limpiarSesion() {
  estado.desuscribirUsuario?.();
  estado.desuscribirLista?.();
  estado.uid = null;
  estado.usuario = null;
  estado.recordatorios = [];
  estado.tokenActual = null;
}

async function asegurarDocumentoUsuario(user) {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      nombre: user.displayName || "",
      email: user.email || "",
      creadoEn: serverTimestamp(),
      ...AJUSTES_POR_DEFECTO,
      tokens: {},
      enviados: {}
    });
  }
}

function suscribirUsuario() {
  estado.desuscribirUsuario?.();
  estado.desuscribirUsuario = onSnapshot(doc(db, "users", estado.uid), (snap) => {
    estado.usuario = mezclarAjustes(snap.data());
    pintarAjustes();
    pintarPicoYPlaca();
    pintarDispositivos();
  });
}

function suscribirRecordatorios() {
  estado.desuscribirLista?.();
  const q = query(collection(db, "users", estado.uid, "recordatorios"), orderBy("fecha"));
  estado.desuscribirLista = onSnapshot(q, (snap) => {
    estado.recordatorios = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    pintarListas();
  });
}

async function guardarAjustes(parcial) {
  if (!estado.uid) return;
  await updateDoc(doc(db, "users", estado.uid), parcial);
}

// ---------- Notificaciones (FCM) ----------
async function prepararNotificaciones() {
  const soportado = await isSupported().catch(() => false);
  const banner = $("#banner-notif");
  if (!soportado || !("Notification" in window) || !("serviceWorker" in navigator)) {
    banner.classList.remove("oculto");
    $("#banner-notif-texto").textContent = esIosSinInstalar()
      ? "En iPhone, agrega la app a la pantalla de inicio (Compartir > Agregar a inicio) para poder recibir notificaciones."
      : "Este navegador no soporta notificaciones push.";
    $("#btn-activar-notif").classList.add("oculto");
    return;
  }
  try {
    estado.swReg = await navigator.serviceWorker.register("/firebase-messaging-sw.js");
    messaging = getMessaging(app);
    onMessage(messaging, (payload) => {
      // Mensaje recibido con la app abierta en primer plano.
      const n = payload.notification || payload.data || {};
      toast(`${n.title || "Recuérdame"}: ${n.body || ""}`, 5000);
    });
  } catch (e) {
    console.warn("Service worker no registrado", e);
  }

  if (Notification.permission === "granted") {
    banner.classList.add("oculto");
    await registrarToken();
  } else if (Notification.permission === "denied") {
    banner.classList.remove("oculto");
    $("#banner-notif-texto").textContent = "Bloqueaste las notificaciones. Actívalas en la configuración del sitio en tu navegador.";
    $("#btn-activar-notif").classList.add("oculto");
  } else {
    banner.classList.remove("oculto");
  }
}

function esIosSinInstalar() {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const instalada = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  return ios && !instalada;
}

$("#btn-activar-notif").addEventListener("click", async () => {
  const permiso = await Notification.requestPermission();
  if (permiso === "granted") {
    $("#banner-notif").classList.add("oculto");
    await registrarToken();
    toast("Notificaciones activadas en este dispositivo.");
  } else {
    toast("No se concedió el permiso de notificaciones.");
  }
});

async function registrarToken() {
  if (!messaging || !estado.swReg || !estado.uid) return;
  try {
    const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: estado.swReg });
    if (!token) return;
    estado.tokenActual = token;
    await updateDoc(
      doc(db, "users", estado.uid),
      new FieldPath("tokens", token),
      { creado: new Date().toISOString(), ua: navigator.userAgent.slice(0, 120) }
    );
  } catch (e) {
    console.error("No se pudo obtener el token FCM", e);
    toast("No se pudo registrar este dispositivo para notificaciones.");
  }
}

$("#btn-probar-notif").addEventListener("click", async () => {
  const btn = $("#btn-probar-notif");
  btn.disabled = true;
  try {
    const idToken = await auth.currentUser.getIdToken();
    const res = await fetch("/.netlify/functions/probar-notificacion", {
      method: "POST",
      headers: { Authorization: `Bearer ${idToken}` }
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || res.statusText);
    toast(`Prueba enviada a ${json.enviados} dispositivo(s).`);
  } catch (e) {
    toast("Error al enviar la prueba: " + e.message, 4000);
  } finally {
    btn.disabled = false;
  }
});

// ---------- Navegación ----------
$$(".nav-btn").forEach((b) => b.addEventListener("click", () => mostrarTab(b.dataset.tab)));

function mostrarTab(nombre) {
  estado.tab = nombre;
  $$(".tab").forEach((t) => t.classList.add("oculto"));
  $(`#tab-${nombre}`).classList.remove("oculto");
  $$(".nav-btn").forEach((b) => b.classList.toggle("activo", b.dataset.tab === nombre));
  window.scrollTo({ top: 0 });
}

$$(".filtro").forEach((b) => b.addEventListener("click", () => {
  estado.filtro = b.dataset.cat;
  $$(".filtro").forEach((x) => x.classList.toggle("activo", x === b));
  pintarListas();
}));

// ---------- Listas ----------
function pintarListas() {
  const hoy = ahoraColombia().iso;
  const items = estado.recordatorios.map((r) => {
    const proxima = proximaFecha(r.fecha, !!r.anual, hoy);
    return { ...r, proxima, dias: diasEntre(hoy, proxima) };
  });

  // Inicio: activos, ordenados por cercanía, máximo 60 días o vencidos.
  const proximos = items
    .filter((r) => r.activo !== false)
    .sort((a, b) => a.dias - b.dias)
    .slice(0, 20);
  pintarLista($("#lista-proximos"), proximos, $("#vacio-proximos"));

  // Todos: con filtro de categoría.
  const todos = items
    .filter((r) => estado.filtro === "todas" || r.categoria === estado.filtro)
    .sort((a, b) => a.dias - b.dias);
  pintarLista($("#lista-todos"), todos, $("#vacio-todos"));
}

function pintarLista(ul, items, vacio) {
  ul.innerHTML = "";
  vacio.classList.toggle("oculto", items.length > 0);
  for (const r of items) {
    const li = document.createElement("li");
    li.className = "item" + (r.activo === false ? " inactivo" : "");
    li.innerHTML = `
      <div class="item-cuerpo">
        <div class="item-titulo"></div>
        <div class="item-meta">
          <span class="chip ${r.categoria}">${ETIQUETA_CAT[r.categoria] || "Otro"}</span>
          <span>${fechaCorta(r.proxima)}${r.anual ? " · anual" : ""}</span>
        </div>
      </div>
      <div class="item-dias ${claseDias(r.dias)}">${textoDias(r.dias)}</div>
      <input type="checkbox" class="toggle toggle-item" ${r.activo !== false ? "checked" : ""} title="Activar o desactivar avisos">
    `;
    li.querySelector(".item-titulo").textContent = r.titulo;
    const tg = li.querySelector(".toggle-item");
    tg.addEventListener("click", (e) => e.stopPropagation());
    tg.addEventListener("change", async () => {
      await updateDoc(doc(db, "users", estado.uid, "recordatorios", r.id), { activo: tg.checked, actualizadoEn: serverTimestamp() });
    });
    li.addEventListener("click", () => abrirFormulario(r));
    ul.appendChild(li);
  }
}

function claseDias(d) {
  if (d < 0) return "vencido";
  if (d === 0) return "hoy";
  if (d <= 7) return "pronto";
  return "";
}

function textoDias(d) {
  if (d < 0) return `hace ${-d} d`;
  if (d === 0) return "hoy";
  if (d === 1) return "mañana";
  return `${d} d`;
}

// ---------- Formulario ----------
const sheet = $("#sheet-form");
const form = $("#form-recordatorio");

$("#btn-nuevo").addEventListener("click", () => abrirFormulario(null));
$$("[data-cerrar]").forEach((el) => el.addEventListener("click", cerrarFormulario));

$$("#f-categoria .chip-sel").forEach((b) => b.addEventListener("click", () => {
  $$("#f-categoria .chip-sel").forEach((x) => x.classList.toggle("activo", x === b));
}));
$$("#f-avisos .chip-sel").forEach((b) => b.addEventListener("click", () => b.classList.toggle("activo")));

function abrirFormulario(r) {
  form.reset();
  $("#f-id").value = r?.id || "";
  $("#form-titulo").textContent = r ? "Editar recordatorio" : "Nuevo recordatorio";
  $("#btn-eliminar").classList.toggle("oculto", !r);
  $("#f-titulo").value = r?.titulo || "";
  $("#f-fecha").value = r?.fecha || ahoraColombia().iso;
  $("#f-anual").checked = !!r?.anual;
  $("#f-notas").value = r?.notas || "";
  $("#f-activo").checked = r ? r.activo !== false : true;
  const cat = r?.categoria || "documento";
  $$("#f-categoria .chip-sel").forEach((x) => x.classList.toggle("activo", x.dataset.val === cat));
  const avisos = r?.avisos || [7, 1, 0];
  $$("#f-avisos .chip-sel").forEach((x) => x.classList.toggle("activo", avisos.includes(Number(x.dataset.val))));
  sheet.classList.remove("oculto");
  setTimeout(() => $("#f-titulo").focus(), 150);
}

function cerrarFormulario() {
  sheet.classList.add("oculto");
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = $("#f-id").value;
  const datos = {
    titulo: $("#f-titulo").value.trim(),
    categoria: $("#f-categoria .chip-sel.activo")?.dataset.val || "otro",
    fecha: $("#f-fecha").value,
    anual: $("#f-anual").checked,
    avisos: $$("#f-avisos .chip-sel.activo").map((x) => Number(x.dataset.val)).sort((a, b) => b - a),
    notas: $("#f-notas").value.trim(),
    activo: $("#f-activo").checked,
    actualizadoEn: serverTimestamp()
  };
  if (!datos.titulo || !datos.fecha) return;
  if (!datos.avisos.length) datos.avisos = [0];
  try {
    if (id) {
      await updateDoc(doc(db, "users", estado.uid, "recordatorios", id), datos);
      toast("Recordatorio actualizado.");
    } else {
      await addDoc(collection(db, "users", estado.uid, "recordatorios"), { ...datos, creadoEn: serverTimestamp() });
      toast("Recordatorio creado.");
    }
    cerrarFormulario();
  } catch (err) {
    toast("No se pudo guardar: " + err.message, 4000);
  }
});

$("#btn-eliminar").addEventListener("click", async () => {
  const id = $("#f-id").value;
  if (!id || !confirm("¿Eliminar este recordatorio?")) return;
  await deleteDoc(doc(db, "users", estado.uid, "recordatorios", id));
  cerrarFormulario();
  toast("Recordatorio eliminado.");
});

// ---------- Ajustes ----------
function llenarHoras() {
  const opciones = Array.from({ length: 24 }, (_, h) => {
    const sufijo = h < 12 ? "a. m." : "p. m.";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `<option value="${h}">${h12}:00 ${sufijo}</option>`;
  }).join("");
  $("#aj-hora").innerHTML = opciones;
  $("#aj-hora-noche").innerHTML = opciones;
}
llenarHoras();

let pintandoAjustes = false;

function pintarAjustes() {
  const u = estado.usuario;
  if (!u) return;
  pintandoAjustes = true;
  $("#aj-notif-global").checked = u.notifGlobal !== false;
  $("#aj-hora").value = String(u.horaAviso ?? 7);
  $("#aj-hora-noche").value = String(u.horaNoche ?? 20);
  $$("[data-cat-toggle]").forEach((t) => { t.checked = u.categorias[t.dataset.catToggle] !== false; });
  $("#aj-pyp-activo").checked = !!u.pyp.activo;
  if (document.activeElement !== $("#aj-pyp-placa")) $("#aj-pyp-placa").value = u.pyp.placa || "";
  $("#aj-pyp-tipo").value = u.pyp.tipo || "carro";
  $("#aj-pyp-noche").checked = u.pyp.noche !== false;
  $("#aj-pyp-manana").checked = u.pyp.manana !== false;
  $("#aj-pyp-festivos").checked = u.pyp.ignorarFestivos !== false;

  const { origen } = rotacionVigente();
  $("#rotacion-origen").textContent = `(${origen}${origen === "automática" && estado.rotacionAuto ? " · " + estado.rotacionAuto.vigencia : ""})`;
  const perso = normalizarRotacion(u.pyp.rotacionPersonalizada);
  $$(".rotacion-grid input").forEach((inp) => {
    if (document.activeElement === inp) return;
    inp.value = perso ? perso[inp.dataset.dia].join(", ") : "";
  });
  pintandoAjustes = false;
}

$("#aj-notif-global").addEventListener("change", (e) => !pintandoAjustes && guardarAjustes({ notifGlobal: e.target.checked }));
$("#aj-hora").addEventListener("change", (e) => guardarAjustes({ horaAviso: Number(e.target.value) }));
$("#aj-hora-noche").addEventListener("change", (e) => guardarAjustes({ horaNoche: Number(e.target.value) }));
$$("[data-cat-toggle]").forEach((t) => t.addEventListener("change", () => {
  if (!pintandoAjustes) guardarAjustes({ [`categorias.${t.dataset.catToggle}`]: t.checked });
}));
$("#aj-pyp-activo").addEventListener("change", (e) => !pintandoAjustes && guardarAjustes({ "pyp.activo": e.target.checked }));
$("#aj-pyp-tipo").addEventListener("change", (e) => guardarAjustes({ "pyp.tipo": e.target.value }));
$("#aj-pyp-noche").addEventListener("change", (e) => !pintandoAjustes && guardarAjustes({ "pyp.noche": e.target.checked }));
$("#aj-pyp-manana").addEventListener("change", (e) => !pintandoAjustes && guardarAjustes({ "pyp.manana": e.target.checked }));
$("#aj-pyp-festivos").addEventListener("change", (e) => !pintandoAjustes && guardarAjustes({ "pyp.ignorarFestivos": e.target.checked }));

$("#aj-pyp-placa").addEventListener("change", (e) => {
  const placa = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 7);
  e.target.value = placa;
  guardarAjustes({ "pyp.placa": placa });
});

$("#btn-guardar-rotacion").addEventListener("click", async () => {
  const rot = {};
  $$(".rotacion-grid input").forEach((inp) => {
    rot[inp.dataset.dia] = inp.value.split(/[,\s]+/).filter(Boolean).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 9);
  });
  const norm = normalizarRotacion(rot);
  if (!norm) { toast("Escribe al menos un dígito en algún día."); return; }
  const paraGuardar = {};
  for (let d = 1; d <= 5; d++) paraGuardar[String(d)] = norm[d];
  await guardarAjustes({ "pyp.rotacionPersonalizada": paraGuardar });
  toast("Rotación personalizada guardada.");
});

$("#btn-limpiar-rotacion").addEventListener("click", async () => {
  await guardarAjustes({ "pyp.rotacionPersonalizada": null });
  toast("Usando la rotación automática.");
});

function pintarDispositivos() {
  const n = Object.keys(estado.usuario?.tokens || {}).length;
  $("#dispositivos-conteo").textContent = n === 0
    ? "Ningún dispositivo registrado todavía."
    : `${n} dispositivo(s) registrado(s).`;
}

// ---------- Tarjeta de pico y placa ----------
function pintarPicoYPlaca() {
  const card = $("#card-pyp");
  const u = estado.usuario;
  if (!u || !u.pyp.activo || !u.pyp.placa) { card.classList.add("oculto"); return; }

  const { rotacion, origen } = rotacionVigente();
  const cfg = { placa: u.pyp.placa, tipo: u.pyp.tipo, rotacion, ignorarFestivos: u.pyp.ignorarFestivos !== false };
  const digito = digitoPlaca(cfg.placa, cfg.tipo);
  if (!rotacion || digito === null) {
    card.classList.remove("oculto");
    card.className = "card card-pyp";
    $("#pyp-placa").textContent = u.pyp.placa;
    $("#pyp-estado").textContent = "Falta la rotación o la placa no tiene dígitos.";
    $("#pyp-detalle").textContent = "";
    return;
  }

  const hoy = ahoraColombia().iso;
  const manana = sumarDias(hoy, 1);
  const hoyTiene = tienePicoYPlaca(hoy, cfg);
  const mananaTiene = tienePicoYPlaca(manana, cfg);

  // Próximo día con restricción (hasta 14 días adelante).
  let proximo = null;
  for (let i = 0; i <= 14; i++) {
    const f = sumarDias(hoy, i);
    if (tienePicoYPlaca(f, cfg)) { proximo = f; break; }
  }

  card.classList.remove("oculto");
  card.className = "card card-pyp " + (hoyTiene ? "hoy" : mananaTiene ? "manana" : "libre");
  $("#pyp-placa").textContent = `${u.pyp.placa} · dígito ${digito}`;

  if (hoyTiene) {
    $("#pyp-estado").textContent = "Hoy tienes pico y placa.";
  } else if (mananaTiene) {
    $("#pyp-estado").textContent = "Mañana tienes pico y placa.";
  } else if (proximo) {
    $("#pyp-estado").textContent = `Hoy puedes circular. Próximo: ${NOMBRES_DIA[new Date(proximo + "T12:00:00").getDay()]} ${fechaCorta(proximo)}.`;
  } else {
    $("#pyp-estado").textContent = "Hoy puedes circular.";
  }

  const digHoy = digitosDelDia(hoy, rotacion, cfg.ignorarFestivos);
  const horario = estado.rotacionAuto?.horario || "Lunes a viernes de 5:00 a. m. a 8:00 p. m.";
  $("#pyp-detalle").textContent = (digHoy.length ? `Hoy restringe ${digHoy.join(" y ")}. ` : "Hoy no hay restricción (fin de semana o festivo). ")
    + `${horario}. Rotación ${origen}.`;
}

// Refrescar la vista al volver a la app (cambio de día, etc.).
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && estado.uid) { pintarListas(); pintarPicoYPlaca(); }
});

// ---------- Arranque ----------
cargarRotacionAuto().then(() => { if (estado.usuario) { pintarAjustes(); pintarPicoYPlaca(); } });
