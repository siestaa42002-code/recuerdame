// Configuración de Firebase para el navegador.
// Valores de: Firebase Console > Configuración del proyecto > General > Tus apps > SDK setup and configuration.
// Estos datos no son secretos; la seguridad está en firestore.rules.

export const firebaseConfig = {
  apiKey: "AIzaSyA1KVzxatxOxQ3xppVfUifg7V0mvcFi_nY",
  authDomain: "recuerdame-d56ed.firebaseapp.com",
  projectId: "recuerdame-d56ed",
  storageBucket: "recuerdame-d56ed.firebasestorage.app",
  messagingSenderId: "757167369055",
  appId: "1:757167369055:web:67b7f2091522f08341e4ea"
};

// Clave pública VAPID para Web Push:
// Configuración del proyecto > Cloud Messaging > Configuración web > Certificados push web > Generar par de claves.
export const vapidKey = "BJ0vg-y_LHZU2pgDS9z6f7mQWro_zv-2dDyFCSME-FM-AtOO0k-kSn-FR00FmcHZ7zgiao56CbSLg-t0xXJb9Rk";