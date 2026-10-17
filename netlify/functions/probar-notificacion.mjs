// Endpoint HTTP: envía una notificación de prueba a todos los dispositivos
// del usuario autenticado. La app lo llama desde Ajustes > "Enviar notificación de prueba".
// Verifica el ID token de Firebase que manda el navegador en Authorization: Bearer <token>.

import { admin, enviarAUsuario } from "./_lib/admin.mjs";

export default async (req) => {
  if (req.method !== "POST") {
    return json({ error: "Método no permitido" }, 405);
  }
  const auth = req.headers.get("authorization") || "";
  const idToken = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!idToken) return json({ error: "Falta el token de sesión" }, 401);

  try {
    const { db, messaging, auth: adminAuth } = admin();
    const decoded = await adminAuth.verifyIdToken(idToken);
    const snap = await db.collection("users").doc(decoded.uid).get();
    const tokens = snap.exists ? snap.data().tokens || {} : {};
    if (!Object.keys(tokens).length) {
      return json({ error: "No hay dispositivos registrados. Activa las notificaciones primero." }, 400);
    }
    const enviados = await enviarAUsuario({ db, messaging }, decoded.uid, tokens, {
      title: "Recuérdame funciona",
      body: "Así se verán tus avisos de documentos, fechas y pico y placa.",
      tag: "prueba"
    });
    return json({ enviados });
  } catch (e) {
    console.error(e);
    return json({ error: e.message || "Error interno" }, 500);
  }
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
