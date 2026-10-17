// 1. Importar las funciones de inicialización desde los servidores de Google (CDN)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";
import { getFunctions } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-functions.js";
import {
  initializeAppCheck,
  ReCaptchaEnterpriseProvider
} from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app-check.js";

// 2. CONFIGURACIÓN DE TU PROYECTO
// 👉 REEMPLAZA todo este bloque 'firebaseConfig' por el que te da Firebase
const firebaseConfig = {
  apiKey: "AIzaSyAo0oxpox4UNYuSeGx8amsMjMc0apxTaa4",
  authDomain: "votaciones-jac.firebaseapp.com",
  projectId: "votaciones-jac",
  storageBucket: "votaciones-jac.firebasestorage.app",
  messagingSenderId: "140975550876",
  appId: "1:140975550876:web:eaa4b035066d4639195859",
  measurementId: "G-QCN7PG3RJ5"
};

// 3. Inicializar Firebase con tu configuración
const app = initializeApp(firebaseConfig);

const appCheckSiteKey = "6LfKVvItAAAAAI5jqRXcht54KwR2At4hAeovvapX";
const esDesarrolloLocal = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);

if (esDesarrolloLocal) {
  self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
}

export const appCheckFirebase = initializeAppCheck(app, {
  provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey),
  isTokenAutoRefreshEnabled: true
});

export const dbFirestore = getFirestore(app);
export const authFirebase = getAuth(app);
export const functionsFirebase = getFunctions(app, "us-central1");
