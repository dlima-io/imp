# Impostor de oficina (disfrazado de planilla)

Juego del impostor para 3 o más personas, en el navegador, con apariencia de planilla de cálculo.

## Cómo se juega (resumen)

- Todos reciben el mismo **concepto** (celda B3), menos el **impostor**, que ve `#N/A`. El rol aparece en D3. Las dos celdas se ven solo al pasar el mouse.
- Por turnos, cada uno escribe una pista en su celda. Después debaten en **Comentarios** (general o en hilos privados) y votan a quién echar.
- Si echan a un impostor, tiene una apuesta: si adivina el concepto, ganan los impostores.
- Impostores: 1 hasta 6 personas, 2 de 7 a 10, 3 desde 11.
- Roles opcionales: Pasante, RRHH, Gerente y Chusma. También hay eventos sorpresa.
- **Esc** oculta todo y muestra una planilla de presupuesto.
- Hojas: **KPIs** (ranking histórico) y **Glosario** (conceptos propios de la oficina).

Las reglas completas están en el menú **Ayuda → Cómo se juega**.

---

## Instalación (unos 10 minutos, una sola vez)

GitHub Pages solo sirve archivos: no puede pasar mensajes en tiempo real entre computadoras. Para eso se usa **Firebase Realtime Database**, que es gratis y alcanza de sobra para una oficina.

> Sin Firebase configurado, el juego arranca en **modo local**: solo funciona entre pestañas del mismo navegador. Sirve para probarlo.

### 1. Crear la base de datos en Firebase

1. Entrá a https://console.firebase.google.com y creá un proyecto (podés desactivar Analytics).
2. En el menú: **Compilación → Realtime Database → Crear base de datos**. Elegí una ubicación y empezá en **modo bloqueado**.
3. En la pestaña **Reglas**, pegá esto y publicá:

```json
{
  "rules": {
    "impostor": { ".read": true, ".write": true }
  }
}
```

4. En **Configuración del proyecto** (el engranaje) → **Tus apps** → ícono **</>** (web): registrá una app con cualquier nombre. **No** hace falta Firebase Hosting.
5. Copiá el objeto `firebaseConfig` que te muestra y pegalo en `js/config.js`, reemplazando `null`:

```js
export const FIREBASE_CONFIG = {
  apiKey: "...",
  authDomain: "...",
  databaseURL: "https://TU-PROYECTO-default-rtdb.firebaseio.com",
  projectId: "...",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "..."
};
```

Revisá que esté `databaseURL`: sin eso el juego queda en modo local. Si no aparece, copiala de la pantalla de Realtime Database.

### 2. Publicarlo en GitHub Pages

1. Creá un repositorio en GitHub y subí todos los archivos de esta carpeta tal cual (`index.html`, `styles.css`, `js/…`).
2. En el repo: **Settings → Pages → Source: Deploy from a branch → main / (root) → Save**.
3. En un minuto queda en `https://TU-USUARIO.github.io/TU-REPO/`.

### 3. Jugar

Uno crea la sala y toca **Compartir** para copiar el enlace (`…#gid=ABCD`). El resto entra con ese enlace, pone su nombre y listo.

---

## Para tener en cuenta

- **No es seguro contra trampas:** alguien que sepa abrir las herramientas de desarrollador puede ver los roles. Es un juego entre compañeros.
- **No guarden nada sensible:** la base es abierta para cualquiera que tenga el enlace.
- La sala la maneja automáticamente quien la creó. Si esa persona se va, otro toma el control solo.
- Si alguien recarga la pestaña, vuelve a su lugar. Si se desconecta más de un minuto en plena partida, queda fuera.
- Si un día la red de la oficina bloquea Firebase, no va a conectar. Se nota porque abajo a la derecha dice "Modo local".
- Para probar en tu compu sin publicar: `python3 -m http.server` en la carpeta y abrí `http://localhost:8000` en dos o tres pestañas (abriendo el archivo con doble clic no funciona).
