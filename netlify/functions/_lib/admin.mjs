// Inicialización compartida de Firebase Admin para las funciones de Netlify.
// Requiere la variable de entorno FIREBASE_SERVICE_ACCOUNT con el JSON de la
// cuenta de servicio (Firebase Console > Configuración > Cuentas de servicio >
// Generar nueva clave privada), codificado en base64.

import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { getAuth } from "firebase-admin/auth";

function credenciales() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error("Falta la variable de entorno FIREBASE_SERVICE_ACCOUNT");
  const json = raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
  return JSON.parse(json);
}

export function admin() {
  if (!getApps().length) {
    initializeApp({ credential: cert(credenciales()) });
  }
  return { db: getFirestore(), messaging: getMessaging(), auth: getAuth() };
}

/**
 * Envía una notificación a todos los tokens de un usuario.
 * Devuelve la cantidad enviada y elimina del documento los tokens inválidos.
 */
export async function enviarAUsuario({ db, messaging }, uid, tokensMap, { title, body, tag, url = "/" }) {
  const tokens = Object.keys(tokensMap || {});
  if (!tokens.length) return 0;

  const res = await messaging.sendEachForMulticast({
    tokens,
    notification: { title, body },
    data: { title, body, tag: tag || "", url },
    webpush: {
      headers: { Urgency: "high", TTL: "43200" },
      notification: { icon: "/icons/icon-192.png", badge: "/icons/icon-192.png", tag: tag || undefined, renotify: !!tag },
      fcmOptions: { link: url }
    }
  });

  // Limpiar tokens muertos (dispositivo desinstaló la app, permiso revocado, etc.).
  const muertos = [];
  res.responses.forEach((r, i) => {
    const code = r.error?.code || "";
    if (!r.success && (code.includes("registration-token-not-registered") || code.includes("invalid-argument"))) {
      muertos.push(tokens[i]);
    }
  });
  if (muertos.length) {
    const { FieldPath, FieldValue } = await import("firebase-admin/firestore");
    const ref = db.collection("users").doc(uid);
    // Los tokens tienen ":" y no sirven en rutas con punto; se usa FieldPath en forma variádica.
    const args = [];
    for (const t of muertos) args.push(new FieldPath("tokens", t), FieldValue.delete());
    await ref.update(...args).catch(() => {});
  }
  return res.successCount;
}
