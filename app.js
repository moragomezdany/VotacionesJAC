
// ==========================================
// 1. IMPORTACIONES
// ==========================================
import { authFirebase, dbFirestore, functionsFirebase } from './firebase-config.js';
import { BaseDeDatosJAC } from './BaseDeDatosJAC.js';
import { Vecino, ProyectoInfraestructura, EleccionPresupuesto } from './clases.js';
import {
    onAuthStateChanged,
    sendPasswordResetEmail,
    signInWithEmailAndPassword
} from 'https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js';

// ==========================================
// 2. INICIALIZACIÓN
// ==========================================
const gestorBD = new BaseDeDatosJAC(dbFirestore, authFirebase, functionsFirebase);
let vecinoLogueado = null;
let propuestasActuales = [];
let cancelarSuscripcionPropuestas = null;
let votoEnProceso = false;
let mostrarSoloResultados = false;
let loginEnProceso = false;
let temporizadorCierreSesion = null;
let temporizadorActualizacionResultados = null;
let modoObservador = false;
let resultadosSeguimiento = null;

// ==========================================
// 3. REFERENCIAS A LA INTERFAZ (DOM)
// ==========================================
// Elementos del Login
const formLogin = document.getElementById('formLogin');
const inputCorreo = document.getElementById('inputCorreo');
const inputClave = document.getElementById('inputClave');
const msjErrorLogin = document.getElementById('msjErrorLogin');
const seccionLogin = document.getElementById('seccionLogin');
const botonLogin = formLogin.querySelector('button[type="submit"]');
const botonRestablecerClave = document.getElementById('btnRestablecerClave');

// Elementos de Votación
const seccionVotacion = document.getElementById('seccionVotacion');
const nombreVecinoSpan = document.getElementById('nombreVecino');
const botonCerrarSesion = document.getElementById('btnCerrarSesion');
const vistaSeleccion = document.getElementById('vistaSeleccion');
const contenedorPropuestas = document.getElementById('contenedorPropuestas');
const msjEstadoVoto = document.getElementById('msjEstadoVoto');
const panelResultados = document.getElementById('panelResultados');
const contenedorResultados = document.getElementById('contenedorResultados');
const panelSeguimiento = document.getElementById('panelSeguimiento');
const botonCerrarSesionSeguimiento = document.getElementById('btnCerrarSesionSeguimiento');
const botonActualizarSeguimiento = document.getElementById('btnActualizarSeguimiento');
const botonDescargarResultados = document.getElementById('btnDescargarResultados');
const botonImprimirResultados = document.getElementById('btnImprimirResultados');
const actualizadoSeguimiento = document.getElementById('actualizadoSeguimiento');
const estadoSeguimiento = document.getElementById('estadoSeguimiento');
const estadoJornada = document.getElementById('estadoJornada');
const graficaBarras = document.getElementById('graficaBarras');
const graficaDona = document.getElementById('graficaDona');
const graficaLinea = document.getElementById('graficaLinea');
const totalParticipantes = document.getElementById('totalParticipantes');
const totalPendientes = document.getElementById('totalPendientes');
const resumenParticipacion = document.getElementById('resumenParticipacion');
const estadoHistorial = document.getElementById('estadoHistorial');

document.querySelectorAll('[data-panel-legal]').forEach((enlace) => {
    enlace.addEventListener('click', () => {
        const panelLegal = document.getElementById(enlace.dataset.panelLegal);
        if (panelLegal instanceof HTMLDetailsElement) {
            panelLegal.open = true;
        }
    });
});

// ==========================================
// 4. LÓGICA DE CONTROL (Eventos)
// ==========================================

onAuthStateChanged(authFirebase, async (usuario) => {
    if (!usuario || loginEnProceso || vecinoLogueado) return;

    try {
        if (await iniciarSesionObservador(usuario)) {
            iniciarSesionExitosamente();
            return;
        }

        const perfil = await gestorBD.obtenerPerfil();
        mostrarSoloResultados = perfil.haVotado === true;
        vecinoLogueado = new Vecino(usuario.uid, perfil.nombre, mostrarSoloResultados);
        iniciarSesionExitosamente();
    } catch (error) {
        console.error("No fue posible restaurar la sesión:", error);
        modoObservador = false;
        try {
            await gestorBD.cerrarSesion();
        } catch (errorCierre) {
            console.error("No fue posible cerrar la sesión inválida:", errorCierre);
        }
        mostrarError(mensajeErrorPerfil(error));
    }
});

// Evento de Login
formLogin.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    msjErrorLogin.classList.remove('mensaje-error');
    msjErrorLogin.textContent = "Verificando tus datos...";
    botonLogin.disabled = true;
    formLogin.setAttribute('aria-busy', 'true');

    const correoDigitado = inputCorreo.value.trim();
    const claveDigitada = inputClave.value;

    try {
        loginEnProceso = true;
        let credenciales;
        try {
            credenciales = await signInWithEmailAndPassword(
                authFirebase,
                correoDigitado,
                claveDigitada
            );
        } catch (error) {
            mostrarError(mensajeErrorInicioSesion(error));
            console.error("Error de Firebase Authentication:", error?.code ?? "sin código", error);
            return;
        }

        let perfil;
        try {
            if (await iniciarSesionObservador(credenciales.user)) {
                inputClave.value = "";
                iniciarSesionExitosamente();
                return;
            }
            perfil = await gestorBD.obtenerPerfil();
        } catch (error) {
            mostrarError(mensajeErrorPerfil(error));
            console.error("Error al obtener el perfil del vecino:", error?.code ?? "sin código", error);
            await cerrarSesionTrasFalloDePerfil();
            modoObservador = false;
            return;
        }

        mostrarSoloResultados = perfil.haVotado === true;
        vecinoLogueado = new Vecino(credenciales.user.uid, perfil.nombre, mostrarSoloResultados);
        inputClave.value = "";
        iniciarSesionExitosamente();
    } finally {
        loginEnProceso = false;
        botonLogin.disabled = false;
        formLogin.removeAttribute('aria-busy');
    }
});

async function cerrarSesionTrasFalloDePerfil() {
    try {
        await gestorBD.cerrarSesion();
    } catch (error) {
        console.error("No fue posible cerrar la sesión sin perfil:", error?.code ?? "sin código", error);
    }
}

async function iniciarSesionObservador(usuario) {
    const resultadoToken = await usuario.getIdTokenResult(true);
    if (resultadoToken.claims.resultsViewer !== true) {
        return false;
    }

    modoObservador = true;
    resultadosSeguimiento = await gestorBD.obtenerResultadosSeguimiento();
    return true;
}

function mensajeErrorPerfil(error) {
    const codigo = error?.code ?? "";

    if (codigo === "functions/not-found") {
        return "El correo inició sesión, pero su cuenta aún no está vinculada al perfil del vecino en Firestore (campo authUid).";
    }

    if (codigo === "functions/failed-precondition") {
        return "La cuenta está vinculada a más de un perfil. Contacta al administrador de la JAC.";
    }

    if (codigo === "functions/internal") {
        return "El inicio de sesión funcionó, pero la función no pudo cargar el perfil. Contacta al administrador para revisar los registros de obtenerPerfilVecino y los permisos de Firestore.";
    }

    if (
        codigo === "functions/unavailable" ||
        codigo === "functions/deadline-exceeded"
    ) {
        return "El servicio de perfiles no respondió a tiempo. Confirma que obtenerPerfilVecino esté activa en us-central1 e intenta nuevamente.";
    }

    if (codigo === "functions/unauthenticated") {
        return "La sesión de Firebase no fue aceptada al consultar el perfil. Cierra sesión y vuelve a ingresar; si continúa, revisa Authentication y App Check.";
    }

    if (codigo === "functions/permission-denied") {
        return "Firebase App Check rechazó la solicitud. Confirma que el token de depuración local esté registrado en la app web correcta de App Check.";
    }

    return "El correo inició sesión, pero no se pudo cargar el perfil. Verifica el despliegue de Cloud Functions y App Check.";
}

botonRestablecerClave.addEventListener('click', async () => {
    const correo = inputCorreo.value.trim();
    msjErrorLogin.classList.remove('mensaje-error');

    if (!inputCorreo.validity.valid || !correo) {
        msjErrorLogin.textContent = "Escribe primero un correo electrónico válido para enviarte las instrucciones.";
        msjErrorLogin.classList.add('mensaje-error');
        inputCorreo.focus();
        return;
    }

    botonRestablecerClave.disabled = true;
    msjErrorLogin.textContent = "Enviando instrucciones...";

    try {
        await sendPasswordResetEmail(authFirebase, correo);
        msjErrorLogin.textContent =
            "Si ese correo tiene una cuenta, Firebase enviará allí las instrucciones para cambiar la contraseña. Revisa también la carpeta de correo no deseado.";
    } catch (error) {
        console.error("Error al solicitar restablecimiento:", error?.code ?? "sin código", error);
        msjErrorLogin.textContent = mensajeErrorRestablecerClave(error);
        msjErrorLogin.classList.add('mensaje-error');
    } finally {
        botonRestablecerClave.disabled = false;
    }
});

function mensajeErrorRestablecerClave(error) {
    if (error?.code === "auth/too-many-requests") {
        return "Firebase limitó temporalmente las solicitudes. Espera antes de volver a intentarlo.";
    }

    if (error?.code === "auth/network-request-failed") {
        return "No se pudo conectar con Firebase. Revisa tu conexión e intenta nuevamente.";
    }

    if (error?.code === "auth/operation-not-allowed") {
        return "El acceso por correo no está habilitado en Firebase Authentication. Contacta al administrador.";
    }

    return "No fue posible enviar las instrucciones. Verifica la configuración de Firebase Authentication e intenta más tarde.";
}

function mensajeErrorInicioSesion(error) {
    const codigo = error?.code ?? "";

    if (
        codigo === "functions/not-found" ||
        codigo === "functions/failed-precondition"
    ) {
        return "Tu cuenta ingresó, pero aún no está vinculada a un perfil de vecino. Contacta al administrador de la JAC.";
    }

    if (codigo === "auth/invalid-credential" || codigo === "auth/invalid-login-credentials") {
        return "No fue posible verificar el correo y la contraseña.";
    }

    if (codigo === "auth/too-many-requests") {
        return "Se bloquearon temporalmente los intentos de acceso. Intenta más tarde o solicita restablecer la contraseña.";
    }

    if (codigo === "auth/network-request-failed") {
        return "No fue posible conectar con Firebase Authentication. Revisa tu conexión e intenta de nuevo.";
    }

    if (codigo.startsWith("auth/")) {
        return "Firebase Authentication rechazó la sesión. Verifica que el proveedor de autenticación esté habilitado.";
    }

    return "No fue posible iniciar sesión. Revisa el correo y la contraseña, o intenta más tarde.";
}

botonCerrarSesion.addEventListener('click', cerrarSesion);
botonCerrarSesionSeguimiento.addEventListener('click', cerrarSesion);

botonActualizarSeguimiento.addEventListener('click', () => {
    void actualizarResultadosSeguimiento();
});

botonDescargarResultados.addEventListener('click', descargarResultadosCSV);
botonImprimirResultados.addEventListener('click', () => {
    document.body.classList.add('imprimir-seguimiento');
    window.print();
});
window.addEventListener('afterprint', () => {
    document.body.classList.remove('imprimir-seguimiento');
});

async function cerrarSesion() {
    if (temporizadorCierreSesion !== null) {
        clearTimeout(temporizadorCierreSesion);
        temporizadorCierreSesion = null;
    }
    if (temporizadorActualizacionResultados !== null) {
        clearInterval(temporizadorActualizacionResultados);
        temporizadorActualizacionResultados = null;
    }

    botonCerrarSesion.disabled = true;
    botonCerrarSesionSeguimiento.disabled = true;
    try {
        if (cancelarSuscripcionPropuestas) {
            cancelarSuscripcionPropuestas();
            cancelarSuscripcionPropuestas = null;
        }
        await gestorBD.cerrarSesion();
        vecinoLogueado = null;
        propuestasActuales = [];
        mostrarSoloResultados = false;
        votoEnProceso = false;
        modoObservador = false;
        resultadosSeguimiento = null;
        document.body.classList.remove('modo-seguimiento');
        seccionVotacion.hidden = true;
        panelSeguimiento.hidden = true;
        seccionLogin.style.display = '';
        contenedorPropuestas.replaceChildren();
        contenedorResultados.replaceChildren();
        mostrarVistaSeleccion();
        msjEstadoVoto.textContent = "";
        msjEstadoVoto.hidden = true;
        inputCorreo.value = "";
        inputClave.value = "";
        msjErrorLogin.textContent = "";
    } catch (error) {
        console.error("No fue posible cerrar la sesión:", error);
        msjEstadoVoto.textContent = "No fue posible cerrar la sesión. Intenta nuevamente.";
        msjEstadoVoto.hidden = false;
    } finally {
        botonCerrarSesion.disabled = false;
        botonCerrarSesionSeguimiento.disabled = false;
    }
}

function mostrarError(mensaje) {
    msjErrorLogin.textContent = mensaje;
    msjErrorLogin.classList.add('mensaje-error');
}

function iniciarSesionExitosamente() {
    seccionLogin.style.display = 'none';
    if (modoObservador) {
        document.body.classList.add('modo-seguimiento');
        panelSeguimiento.hidden = false;
        renderizarResultadosSeguimiento();
        temporizadorActualizacionResultados = setInterval(() => {
            void actualizarResultadosSeguimiento();
        }, 30000);
        return;
    }

    seccionVotacion.hidden = false;
    nombreVecinoSpan.textContent = vecinoLogueado.nombre;

    cargarPropuestasEnPantalla();
}

async function actualizarResultadosSeguimiento() {
    if (!modoObservador || botonActualizarSeguimiento.disabled) return;

    botonActualizarSeguimiento.disabled = true;
    estadoSeguimiento.textContent = "Actualizando resultados...";
    try {
        const resultadosNuevos = await gestorBD.obtenerResultadosSeguimiento();
        if (!modoObservador) return;
        resultadosSeguimiento = resultadosNuevos;
        renderizarResultadosSeguimiento();
        estadoSeguimiento.textContent = "Resultados actualizados. Se refrescan automáticamente cada 30 segundos.";
    } catch (error) {
        console.error("No fue posible actualizar los resultados:", error?.code ?? "sin código", error);
        estadoSeguimiento.textContent = "No se pudieron actualizar los resultados. Intenta nuevamente.";
    } finally {
        botonActualizarSeguimiento.disabled = false;
    }
}

function renderizarResultadosSeguimiento() {
    if (!resultadosSeguimiento) return;

    const formatoNumero = new Intl.NumberFormat('es-CO');
    const fechaActualizacion = new Date(resultadosSeguimiento.generadoEn);
    actualizadoSeguimiento.dateTime = fechaActualizacion.toISOString();
    actualizadoSeguimiento.textContent = fechaActualizacion.toLocaleString('es-CO', {
        dateStyle: 'medium',
        timeStyle: 'short'
    });

    const cierreVotacion = new Date('2026-10-30T18:00:00-05:00');
    const votacionActiva = fechaActualizacion < cierreVotacion;
    estadoJornada.textContent = votacionActiva ? '● Votación activa' : '● Votación cerrada';
    estadoJornada.classList.toggle('etiqueta-cerrada', !votacionActiva);

    renderizarGraficaBarras(formatoNumero);
    renderizarGraficaDona(formatoNumero);
    renderizarGraficaLinea(formatoNumero);
}

function renderizarGraficaBarras(formatoNumero) {
    if (resultadosSeguimiento.propuestas.length === 0) {
        graficaBarras.replaceChildren(crearAvisoGrafica('No hay propuestas disponibles.'));
        return;
    }

    const colores = ['#16845b', '#1557a6', '#7b61a8', '#d28b26', '#cc5a4f'];
    const filas = resultadosSeguimiento.propuestas.map((resultado, indice) => {
        const porcentaje = Math.max(0, Math.min(Number(resultado.porcentaje) || 0, 100));
        const fila = document.createElement('article');
        fila.className = 'fila-barra-grafica';
        fila.setAttribute('role', 'listitem');

        const encabezado = document.createElement('div');
        encabezado.className = 'fila-barra-encabezado';
        const titulo = document.createElement('span');
        titulo.className = 'titulo-barra-grafica';
        titulo.textContent = resultado.titulo;
        const valor = document.createElement('strong');
        valor.textContent = `${porcentaje.toFixed(1)}%`;
        encabezado.append(titulo, valor);

        const barra = document.createElement('div');
        barra.className = 'barra-seguimiento';
        barra.setAttribute('role', 'progressbar');
        barra.setAttribute('aria-label', `Porcentaje de votos para ${resultado.titulo}`);
        barra.setAttribute('aria-valuemin', '0');
        barra.setAttribute('aria-valuemax', '100');
        barra.setAttribute('aria-valuenow', porcentaje.toFixed(1));
        const progreso = document.createElement('span');
        progreso.style.width = `${porcentaje}%`;
        progreso.style.backgroundColor = colores[indice % colores.length];
        barra.append(progreso);

        const detalle = document.createElement('div');
        detalle.className = 'detalle-barra-grafica';
        detalle.append(
            crearTextoGrafica(`${formatoNumero.format(resultado.votos)} ${resultado.votos === 1 ? 'voto' : 'votos'}`),
            crearTextoGrafica(`${formatoNumero.format(resultadosSeguimiento.totalVotos)} en total`)
        );
        fila.append(encabezado, barra, detalle);
        return fila;
    });
    graficaBarras.replaceChildren(...filas);
}

function renderizarGraficaDona(formatoNumero) {
    const { registrados, participantes, pendientes, porcentaje } = resultadosSeguimiento.participacion;
    totalParticipantes.textContent = formatoNumero.format(participantes);
    totalPendientes.textContent = formatoNumero.format(pendientes);
    resumenParticipacion.textContent =
        `${formatoNumero.format(participantes)} de ${formatoNumero.format(registrados)} vecinos registrados (${porcentaje.toFixed(1)}%)`;

    const svg = crearSVG('svg', {
        viewBox: '0 0 220 220',
        role: 'img',
        'aria-label': `${porcentaje.toFixed(1)} por ciento de participación: ${participantes} participantes y ${pendientes} pendientes`
    });
    const circunferencia = 2 * Math.PI * 78;
    const anilloBase = crearSVG('circle', {
        cx: '110', cy: '110', r: '78', fill: 'none', stroke: '#e3eaf0', 'stroke-width': '18'
    });
    const anilloParticipantes = crearSVG('circle', {
        cx: '110', cy: '110', r: '78', fill: 'none', stroke: '#16845b', 'stroke-width': '18',
        'stroke-linecap': 'round',
        'stroke-dasharray': `${circunferencia * Math.max(0, Math.min(porcentaje, 100)) / 100} ${circunferencia}`,
        transform: 'rotate(-90 110 110)'
    });
    const textoPorcentaje = crearSVG('text', {
        x: '110', y: '105', 'text-anchor': 'middle', class: 'texto-dona-porcentaje'
    });
    textoPorcentaje.textContent = `${porcentaje.toFixed(0)}%`;
    const textoEtiqueta = crearSVG('text', {
        x: '110', y: '130', 'text-anchor': 'middle', class: 'texto-dona-etiqueta'
    });
    textoEtiqueta.textContent = 'participación';
    svg.append(anilloBase, anilloParticipantes, textoPorcentaje, textoEtiqueta);
    graficaDona.replaceChildren(svg);
}

function renderizarGraficaLinea(formatoNumero) {
    const puntos = resultadosSeguimiento.serieHoraria;
    if (!puntos.length) {
        graficaLinea.replaceChildren(crearAvisoGrafica('Sin actividad registrada en las últimas 24 horas.'));
        estadoHistorial.textContent = 'El historial horario comienza con los votos emitidos después de activar este seguimiento.';
        return;
    }

    const svg = crearSVG('svg', {
        viewBox: '0 0 520 250',
        role: 'img',
        'aria-label': `Votos por hora durante las últimas 24 horas. ${puntos.reduce((total, punto) => total + punto.votos, 0)} votos registrados.`
    });
    const margen = { arriba: 18, derecha: 18, abajo: 42, izquierda: 38 };
    const ancho = 520 - margen.izquierda - margen.derecha;
    const alto = 250 - margen.arriba - margen.abajo;
    const maximoVotos = Math.max(1, ...puntos.map((punto) => punto.votos));
    const marcas = [...new Set([0, Math.ceil(maximoVotos / 2), maximoVotos])];

    marcas.forEach((marca) => {
        const y = margen.arriba + alto - (marca / maximoVotos) * alto;
        svg.append(crearSVG('line', {
            x1: String(margen.izquierda), y1: String(y),
            x2: String(margen.izquierda + ancho), y2: String(y),
            class: 'linea-guia'
        }));
        const etiqueta = crearSVG('text', {
            x: String(margen.izquierda - 8), y: String(y + 4),
            'text-anchor': 'end', class: 'etiqueta-eje'
        });
        etiqueta.textContent = formatoNumero.format(marca);
        svg.append(etiqueta);
    });

    const coordenadas = puntos.map((punto, indice) => ({
        x: margen.izquierda + (puntos.length === 1 ? ancho / 2 : (indice / (puntos.length - 1)) * ancho),
        y: margen.arriba + alto - (punto.votos / maximoVotos) * alto,
        punto
    }));
    const primerPunto = coordenadas[0];
    const ultimoPunto = coordenadas[coordenadas.length - 1];
    const area = [
        `M ${primerPunto.x} ${margen.arriba + alto}`,
        ...coordenadas.map(({ x, y }) => `L ${x} ${y}`),
        `L ${ultimoPunto.x} ${margen.arriba + alto} Z`
    ].join(' ');
    svg.append(crearSVG('path', { d: area, class: 'area-linea-grafica' }));
    svg.append(crearSVG('polyline', {
        points: coordenadas.map(({ x, y }) => `${x},${y}`).join(' '),
        class: 'trazo-linea-grafica'
    }));

    coordenadas.forEach(({ x, y, punto }) => {
        const marcador = crearSVG('circle', { cx: String(x), cy: String(y), r: '4.5', class: 'marcador-linea-grafica' });
        const titulo = crearSVG('title');
        const horaLocal = new Date(punto.hora).toLocaleTimeString('es-CO', {
            hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota'
        });
        titulo.textContent = `${horaLocal}: ${formatoNumero.format(punto.votos)} votos`;
        marcador.append(titulo);
        svg.append(marcador);
    });

    [coordenadas[0], coordenadas[Math.floor((coordenadas.length - 1) / 2)], ultimoPunto]
        .filter((coordenada, indice, arreglo) => arreglo.findIndex((item) => item.x === coordenada.x) === indice)
        .forEach(({ x, punto }) => {
            const etiqueta = crearSVG('text', {
                x: String(x), y: String(margen.arriba + alto + 25),
                'text-anchor': 'middle', class: 'etiqueta-eje'
            });
            etiqueta.textContent = new Date(punto.hora).toLocaleTimeString('es-CO', {
                hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota'
            });
            svg.append(etiqueta);
        });

    graficaLinea.replaceChildren(svg);
    const inicio = new Date(puntos[0].hora).toLocaleString('es-CO', {
        dateStyle: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota'
    });
    estadoHistorial.textContent = `Registro horario disponible desde ${inicio}.`;
}

function crearSVG(nombre, atributos = {}) {
    const elemento = document.createElementNS('http://www.w3.org/2000/svg', nombre);
    Object.entries(atributos).forEach(([atributo, valor]) => elemento.setAttribute(atributo, valor));
    return elemento;
}

function crearAvisoGrafica(mensaje) {
    const aviso = document.createElement('p');
    aviso.className = 'sin-datos-grafica';
    aviso.textContent = mensaje;
    return aviso;
}

function crearTextoGrafica(texto) {
    const elemento = document.createElement('span');
    elemento.textContent = texto;
    return elemento;
}

function descargarResultadosCSV() {
    if (!resultadosSeguimiento) return;

    const protegerCeldaCSV = (valor) => {
        const texto = String(valor);
        const seguro = /^[\s]*[=+\-@]/.test(texto) ? `'${texto}` : texto;
        return `"${seguro.replaceAll('"', '""')}"`;
    };
    const filas = [
        ["RESULTADOS DE VOTACIÓN JAC"],
        ["Generado", resultadosSeguimiento.generadoEn],
        ["Participantes registrados", resultadosSeguimiento.participacion.participantes],
        ["Vecinos registrados", resultadosSeguimiento.participacion.registrados],
        ["Pendientes", resultadosSeguimiento.participacion.pendientes],
        ["Participación", `${resultadosSeguimiento.participacion.porcentaje.toFixed(1)}%`],
        [],
        ["Propuesta", "Votos", "Porcentaje"],
        ...resultadosSeguimiento.propuestas.map((resultado) => [
            resultado.titulo,
            resultado.votos,
            `${resultado.porcentaje.toFixed(1)}%`
        ]),
        ["Total de votos", resultadosSeguimiento.totalVotos, ""],
        [],
        ["Hora (UTC)", "Votos registrados"],
        ...resultadosSeguimiento.serieHoraria.map(({ hora, votos }) => [hora, votos])
    ];
    const csv = `\uFEFF${filas.map((fila) => fila.map(protegerCeldaCSV).join(",")).join("\r\n")}`;
    const archivo = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(archivo);
    const enlace = document.createElement('a');
    enlace.href = url;
    enlace.download = `resultados-votacion-${new Date().toISOString().slice(0, 10)}.csv`;
    enlace.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ==========================================
// 5. LÓGICA DE VOTACIÓN (Cargar Propuestas)
// ==========================================

async function cargarPropuestasEnPantalla() {
    contenedorPropuestas.innerHTML = "<p class='estado-mensaje'>Cargando propuestas de la JAC...</p>";

    try {
        if (cancelarSuscripcionPropuestas) {
            cancelarSuscripcionPropuestas();
        }

        cancelarSuscripcionPropuestas = gestorBD.suscribirseAPropuestasActivas(
            (datosPropuestas) => {
                propuestasActuales = datosPropuestas
                    .map(crearObjetoPropuesta)
                    .filter(Boolean);
                renderizarPropuestas();
            },
            () => {
                mostrarErrorPropuestas("No fue posible actualizar las propuestas. Intenta recargar la página.");
            }
        );

    } catch (error) {
        console.error("Error al cargar propuestas:", error);
        mostrarErrorPropuestas("No fue posible cargar las propuestas. Intenta nuevamente más tarde.");
    }
}

function mostrarErrorPropuestas(mensaje) {
    const aviso = document.createElement('p');
    aviso.className = 'estado-mensaje estado-mensaje-error';
    aviso.textContent = mensaje;
    contenedorPropuestas.replaceChildren(aviso);
}

function crearObjetoPropuesta(dato) {
    if (dato.tipo === "infraestructura") {
        return new ProyectoInfraestructura(
            dato.idDoc, dato.titulo, dato.descripcion, Number(dato.conteoVotos) || 0,
            dato.presupuestoEstimado, dato.duracionMeses
        );
    }

    if (dato.tipo === "presupuesto") {
        return new EleccionPresupuesto(
            dato.idDoc, dato.titulo, dato.descripcion, Number(dato.conteoVotos) || 0,
            dato.rubro
        );
    }

    return null;
}

function renderizarPropuestas() {
    const usuarioYaVoto =
        mostrarSoloResultados ||
        vecinoLogueado.getHaVotado();

    if (propuestasActuales.length === 0) {
        if (usuarioYaVoto) {
            mostrarVistaResultados();
            mostrarAvisoResultados("Todavía no hay resultados disponibles.");
        } else {
            mostrarAvisoPropuestas("No hay propuestas activas en este momento.");
        }
        return;
    }

    if (usuarioYaVoto) {
        mostrarSoloResultados = true;
        mostrarVistaResultados();
        renderizarResultados();
        return;
    }

    mostrarVistaSeleccion();
    contenedorPropuestas.innerHTML = "";
    const totalVotos = propuestasActuales.reduce(
        (total, propuesta) => total + propuesta.getVotos(),
        0
    );

    propuestasActuales.forEach((propuesta) => {
        renderizarBotonPropuesta(propuesta, totalVotos);
    });
}

function renderizarResultados() {
    contenedorResultados.innerHTML = "";
    const totalVotos = propuestasActuales.reduce(
        (total, propuesta) => total + propuesta.getVotos(),
        0
    );

    propuestasActuales.forEach((propuesta) => {
        const votos = propuesta.getVotos();
        const porcentaje = totalVotos === 0 ? 0 : (votos / totalVotos) * 100;
        const tarjeta = document.createElement('article');
        tarjeta.className = 'tarjeta-resultado';
        const fila = document.createElement('div');
        fila.className = 'fila-resultado';
        const titulo = document.createElement('h3');
        titulo.textContent = propuesta.titulo;
        const porcentajeTexto = document.createElement('strong');
        porcentajeTexto.textContent = `${porcentaje.toFixed(1)}%`;
        fila.append(titulo, porcentajeTexto);
        tarjeta.append(fila, crearBarraProgreso(porcentaje, `Porcentaje de votos para ${propuesta.titulo}`));
        tarjeta.appendChild(crearCantidadVotos(votos));
        contenedorResultados.appendChild(tarjeta);
    });
}

function crearBarraProgreso(porcentaje, etiqueta) {
    const valorSeguro = Math.max(0, Math.min(porcentaje, 100));
    const porcentajeVisible = valorSeguro.toFixed(1);
    const barra = document.createElement('div');
    barra.className = 'barra-progreso';
    barra.setAttribute('role', 'progressbar');
    barra.setAttribute('aria-valuenow', porcentajeVisible);
    barra.setAttribute('aria-valuemin', '0');
    barra.setAttribute('aria-valuemax', '100');
    barra.setAttribute('aria-label', etiqueta);

    const valor = document.createElement('div');
    valor.className = 'barra-progreso-valor';
    valor.style.width = `${valorSeguro}%`;
    barra.appendChild(valor);
    return barra;
}

function crearCantidadVotos(votos) {
    const cantidad = document.createElement('span');
    cantidad.className = 'cantidad-votos';
    cantidad.textContent = `${new Intl.NumberFormat('es-CO').format(votos)} ${votos === 1 ? "voto" : "votos"}`;
    return cantidad;
}

function mostrarAvisoPropuestas(mensaje) {
    const aviso = document.createElement('p');
    aviso.className = 'estado-mensaje';
    aviso.textContent = mensaje;
    contenedorPropuestas.replaceChildren(aviso);
}

function mostrarAvisoResultados(mensaje) {
    const aviso = document.createElement('p');
    aviso.className = 'estado-mensaje';
    aviso.textContent = mensaje;
    contenedorResultados.replaceChildren(aviso);
}

function mostrarVistaResultados() {
    vistaSeleccion.classList.add('vista-oculta');
    vistaSeleccion.setAttribute('aria-hidden', 'true');
    vistaSeleccion.inert = true;
    actualizarBotonesDespuesDeVotar();

    panelResultados.hidden = false;
    requestAnimationFrame(() => {
        panelResultados.classList.add('vista-visible');
    });
}

function mostrarVistaSeleccion() {
    vistaSeleccion.classList.remove('vista-oculta');
    vistaSeleccion.setAttribute('aria-hidden', 'false');
    vistaSeleccion.inert = false;
    panelResultados.classList.remove('vista-visible');
    panelResultados.hidden = true;
}

function renderizarBotonPropuesta(objetoPropuesta, totalVotos) {
    const divPropuesta = document.createElement('div');
    divPropuesta.className = 'tarjeta-propuesta';

    const votos = objetoPropuesta.getVotos();
    const porcentaje = totalVotos === 0 ? 0 : (votos / totalVotos) * 100;
    const usuarioYaVoto = vecinoLogueado.getHaVotado();

    const titulo = document.createElement('h3');
    titulo.textContent = objetoPropuesta.titulo;

    const resultado = document.createElement('div');
    resultado.className = 'resultado-propuesta';
    const filaResultado = document.createElement('div');
    filaResultado.className = 'fila-resultado';
    const etiquetaResultado = document.createElement('span');
    etiquetaResultado.textContent = 'Resultado actual';
    const porcentajeResultado = document.createElement('strong');
    porcentajeResultado.textContent = `${porcentaje.toFixed(1)}%`;
    filaResultado.append(etiquetaResultado, porcentajeResultado);
    resultado.append(
        filaResultado,
        crearBarraProgreso(porcentaje, `Porcentaje de votos para ${objetoPropuesta.titulo}`),
        crearCantidadVotos(votos)
    );

    const btnVotar = document.createElement('button');
    btnVotar.type = 'button';
    btnVotar.className = `btn-votar${usuarioYaVoto ? ' btn-deshabilitado' : ''}`;
    btnVotar.disabled = usuarioYaVoto || votoEnProceso;
    btnVotar.textContent = usuarioYaVoto ? '✅ Voto registrado' : '✅ Votar por esta propuesta';
    divPropuesta.append(titulo, crearDetallesPropuesta(objetoPropuesta), resultado, btnVotar);

    btnVotar.addEventListener('click', async () => {
        if (votoEnProceso || vecinoLogueado.getHaVotado()) {
            return;
        }

        const confirmar = confirm(`¿Estás seguro de votar por: ${objetoPropuesta.titulo}?`);

        if (confirmar) {
            votoEnProceso = true;
            msjEstadoVoto.hidden = true;
            msjEstadoVoto.textContent = "";
            renderizarPropuestas();

            try {
                const exito = await vecinoLogueado.votar(objetoPropuesta.id, gestorBD);

                if (exito) {
                    votoEnProceso = false;
                    mostrarSoloResultados = true;
                    renderizarPropuestas();
                    actualizarBotonesDespuesDeVotar();
                    msjEstadoVoto.textContent =
                        "Tu voto quedó registrado. La sesión se cerrará automáticamente en 3 segundos.";
                    msjEstadoVoto.hidden = false;
                    temporizadorCierreSesion = setTimeout(() => {
                        temporizadorCierreSesion = null;
                        void cerrarSesion();
                    }, 3000);
                } else {
                    votoEnProceso = false;
                    renderizarPropuestas();
                }
            } catch (error) {
                votoEnProceso = false;
                renderizarPropuestas();
                msjEstadoVoto.textContent =
                    "No fue posible confirmar el voto. Actualiza la página para verificar tu participación antes de intentarlo de nuevo.";
                msjEstadoVoto.hidden = false;
                console.error("No fue posible registrar el voto:", error);
            }
        }
    });

    contenedorPropuestas.appendChild(divPropuesta);
}

function crearDetallesPropuesta(propuesta) {
    const detalles = document.createElement('div');
    detalles.className = 'detalle-tecnico';

    const filas = propuesta instanceof ProyectoInfraestructura
        ? [
            { icono: '💵', etiqueta: 'Presupuesto estimado', valor: propuesta.presupuestoEstimado == null ? 'Sin especificar' : `$${propuesta.presupuestoEstimado}` },
            { icono: '⏱️', etiqueta: 'Duración', valor: propuesta.duracionMeses == null ? 'Sin especificar' : `${propuesta.duracionMeses} meses` }
        ]
        : [
            { icono: '💵', etiqueta: 'Modalidad', valor: 'Presupuesto comunitario' },
            { icono: '🏷️', etiqueta: 'Rubro', valor: propuesta.rubro }
        ];

    filas.forEach(({ icono, etiqueta, valor }) => {
        const fila = document.createElement('p');
        fila.className = 'detalle-fila';

        const simbolo = document.createElement('span');
        simbolo.className = 'detalle-icono';
        simbolo.setAttribute('aria-hidden', 'true');
        simbolo.textContent = icono;

        const texto = document.createElement('span');
        texto.className = 'detalle-texto';
        const nombre = document.createElement('strong');
        nombre.textContent = etiqueta;
        const contenido = document.createElement('span');
        contenido.textContent = valor ?? 'Sin especificar';

        texto.append(nombre, contenido);
        fila.append(simbolo, texto);
        detalles.appendChild(fila);
    });

    return detalles;
}

function actualizarBotonesDespuesDeVotar() {
    const botonesVotar = document.querySelectorAll('.btn-votar');

    botonesVotar.forEach((boton) => {
        boton.disabled = true;
        boton.classList.add('btn-deshabilitado');
        boton.textContent = '✅ Voto registrado';
    });
}
