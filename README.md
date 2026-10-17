# Recuérdame

PWA de recordatorios de renovaciones de documentos, fechas importantes, pagos y pico y placa, con notificaciones push personalizadas mediante interruptores (toggles).

- Frontend: HTML/CSS/JS sin framework, Firebase Auth (Google) + Firestore + Cloud Messaging.
- Backend: una función programada de Netlify (gratis, corre cada hora) que consulta Firestore y envía los push con Firebase Admin. No requiere plan Blaze.
- Pico y placa: rotación oficial de Medellín y el Valle de Aburrá cargada desde `data/pico-y-placa.json` (se actualiza cada semestre con un commit) y personalizable desde la app. Respeta fines de semana y festivos de Colombia (Ley Emiliani).

## Estructura

```
recuerdame/
├── index.html                      Interfaz (login, inicio, todos, ajustes, formulario)
├── css/styles.css
├── js/app.js                       Lógica de la app
├── js/pico-y-placa.js              Fechas, festivos y pico y placa (compartido con el backend)
├── js/firebase-config.js           <- pon aquí tu configuración de Firebase
├── firebase-messaging-sw.js        Service worker de FCM (<- también lleva la configuración)
├── data/pico-y-placa.json          Rotación vigente
├── manifest.webmanifest, icons/    PWA
├── firestore.rules                 Reglas de seguridad
├── netlify.toml, package.json
└── netlify/functions/
    ├── enviar-recordatorios.mjs    Programada: cada hora
    ├── probar-notificacion.mjs     HTTP: botón "Enviar notificación de prueba"
    └── _lib/admin.mjs              Firebase Admin compartido
```

## Modelo de datos (Firestore)

```
users/{uid}
  nombre, email, creadoEn
  notifGlobal: true                 interruptor general
  horaAviso: 7                      hora (0-23, Colombia) de los avisos diarios
  horaNoche: 20                     hora del aviso de "mañana tienes pico y placa"
  categorias: { documento, fecha, pago, otro }   true/false
  pyp: { activo, placa, tipo: "carro"|"moto", noche, manana, ignorarFestivos, rotacionPersonalizada }
  tokens: { "<token FCM>": { creado, ua } }      dispositivos registrados
  enviados: { "<clave>": "YYYY-MM-DD" }          deduplicación de avisos

users/{uid}/recordatorios/{id}
  titulo, categoria, fecha (YYYY-MM-DD), anual, avisos: [30, 7, 1, 0], notas, activo
```

## Configuración paso a paso

### 1. Firebase

1. Crea un proyecto en https://console.firebase.google.com (plan Spark, gratuito).
2. **Authentication** > Método de acceso > habilita **Google**.
3. **Firestore Database** > crear base de datos (modo producción) > pestaña **Reglas** > pega el contenido de `firestore.rules` y publica.
4. **Configuración del proyecto** > **Tus apps** > agrega una app **Web** > copia el objeto `firebaseConfig` en:
   - `js/firebase-config.js`
   - `firebase-messaging-sw.js` (mismos valores; el service worker no puede importar el otro archivo).
5. **Configuración del proyecto** > **Cloud Messaging** > **Certificados push web** > *Generar par de claves* > copia la clave pública en `vapidKey` de `js/firebase-config.js`.
6. **Configuración del proyecto** > **Cuentas de servicio** > *Generar nueva clave privada*. Guarda el JSON (no lo subas al repositorio). Conviértelo a base64:
   ```bash
   base64 -w 0 serviceAccount.json      # Linux
   base64 -i serviceAccount.json        # macOS
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("serviceAccount.json"))   # PowerShell
   ```
7. **Authentication** > **Configuración** > **Dominios autorizados** > agrega el dominio de Netlify (por ejemplo `recuerdame.netlify.app`) para que funcione el inicio de sesión con Google.

### 2. Netlify

1. Sube la carpeta a un repositorio de GitHub y crea el sitio en Netlify desde ese repositorio. `netlify.toml` ya define `publish = "."` y la carpeta de funciones.
2. **Site configuration** > **Environment variables** > crea `FIREBASE_SERVICE_ACCOUNT` con el base64 del paso 6.
3. Despliega. Netlify instala `firebase-admin` desde `package.json`, empaqueta las funciones con esbuild y registra `enviar-recordatorios` como tarea programada `@hourly` (se ve en **Functions** con la etiqueta *Scheduled*).

### 3. Probar

1. Abre el sitio, entra con Google y toca **Activar** en el aviso de notificaciones.
2. En **Ajustes** > *Dispositivos* > **Enviar notificación de prueba**. Debe llegar un push al instante. Si falla, revisa en Netlify > Functions > `probar-notificacion` > Logs.
3. Crea un recordatorio con fecha de hoy y "El mismo día" marcado, y en Ajustes pon la hora de avisos en la hora siguiente. La función corre al minuto 0 de cada hora (hora de Colombia, UTC-5 fijo).

Para probar la función programada en local sin esperar:

```bash
npm install
netlify login
netlify link
npm run enviar:local        # equivale a invocarla como si fueran las 7:00 a. m.
```

El parámetro `forzar=HH` simula la hora; la fecha siempre es la real.

## Cómo funciona el envío

Cada hora, la función recorre `users`. Para cada usuario con `notifGlobal` activo y al menos un token:

- Si la hora actual es `horaAviso`: revisa cada recordatorio activo cuya categoría esté encendida. Si los días que faltan coinciden con alguno de sus `avisos`, envía. Si no es anual y venció hace 1 a 3 días, envía un aviso de vencido. Si el pico y placa está activo, `manana` encendido y hoy le toca, envía "Hoy tienes pico y placa".
- Si la hora actual es `horaNoche` y `noche` está encendido y mañana le toca, envía "Mañana tienes pico y placa".
- Cada envío queda marcado en `enviados` con una clave única (recordatorio + fecha, o pyp + fecha), así no se repite aunque la función corra dos veces. Las marcas de más de 60 días se podan solas.
- Los tokens inválidos (app desinstalada, permiso revocado) se borran automáticamente.

## Pico y placa

- Rotación por defecto: `data/pico-y-placa.json`. Vigente desde el 3 de agosto de 2026 hasta enero de 2027: lunes 5-8, martes 1-4, miércoles 0-2, jueves 3-6, viernes 7-9, de 5:00 a. m. a 8:00 p. m.
- Carros: último dígito de la placa. Motos de 2 y 4 tiempos: primer dígito.
- Cuando la Alcaldía publique la siguiente rotación, edita el JSON (`rotacion`, `vigencia`, `actualizado`) y haz commit; la app y la función la toman de ahí.
- Si la app aún no está actualizada, el usuario puede escribir su propia rotación en Ajustes > Pico y placa > Rotación; esa tiene prioridad hasta que la borre.
- No se avisa en sábados, domingos ni festivos (desactivable con el interruptor "Ignorar festivos").

## Notas de plataforma

- **Android (Chrome)**: funciona en el navegador y mejor aún instalada como PWA ("Agregar a pantalla de inicio").
- **iPhone/iPad**: las notificaciones push solo funcionan si la app está instalada en la pantalla de inicio (iOS 16.4 o superior). La app lo indica en el aviso superior.
- **Escritorio**: Chrome, Edge y Firefox reciben push mientras el navegador esté abierto (aunque la pestaña esté cerrada).
- Si un usuario cierra sesión, el token de ese dispositivo se elimina y deja de recibir avisos allí.

## Mejoras pendientes

- Notificación local (sin push) mientras la app está abierta.
- Importar/exportar recordatorios.
- Soporte para otras ciudades (Bogotá tiene rotación par/impar por día, distinta lógica).
