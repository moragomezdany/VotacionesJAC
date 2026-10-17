import {
  collection,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";
import {
  signOut
} from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";
import {
  httpsCallable
} from "https://www.gstatic.com/firebasejs/10.9.0/firebase-functions.js";

export class BaseDeDatosJAC {
  constructor(dbInstancia, authInstancia, functionsInstancia) {
    this.db = dbInstancia;
    this.auth = authInstancia;
    this.functions = functionsInstancia;
  }

  async obtenerPerfil() {
    const obtenerPerfil = httpsCallable(this.functions, "obtenerPerfilVecino");
    const respuesta = await obtenerPerfil();
    return respuesta.data;
  }

  async obtenerResultadosSeguimiento() {
    const obtenerResultados = httpsCallable(this.functions, "obtenerResultadosSeguimiento");
    const respuesta = await obtenerResultados();
    return respuesta.data;
  }

  async cerrarSesion() {
    await signOut(this.auth);
  }

  suscribirseAPropuestasActivas(callback, callbackError) {
    return onSnapshot(
      collection(this.db, "propuestas"),
      (snapshot) => {
        const propuestas = snapshot.docs.map((documento) => ({
          idDoc: documento.id,
          ...documento.data()
        }));
        callback(propuestas);
      },
      (error) => {
        console.error("Error al escuchar las propuestas:", error);
        if (callbackError) callbackError(error);
      }
    );
  }

  async registrarVotoEnBD(idDocPropuesta) {
    const registrarVoto = httpsCallable(this.functions, "registrarVoto");
    const respuesta = await registrarVoto({ idPropuesta: idDocPropuesta });
    return respuesta.data.registrado === true;
  }
}
