const { initializeApp } = require("firebase-admin/app");
const { Timestamp, getFirestore } = require("firebase-admin/firestore");
const { HttpsError, onCall } = require("firebase-functions/v2/https");

initializeApp();

const db = getFirestore();

async function obtenerDocumentoVecinoVinculado(uid) {
  const usuarios = await db.collection("usuarios")
    .where("authUid", "==", uid)
    .limit(2)
    .get();

  if (usuarios.empty) {
    throw new HttpsError(
      "not-found",
      "La cuenta de Authentication no está vinculada a un perfil de vecino."
    );
  }

  if (usuarios.size !== 1) {
    throw new HttpsError(
      "failed-precondition",
      "La cuenta está vinculada a más de un perfil de vecino."
    );
  }

  return usuarios.docs[0];
}

exports.obtenerPerfilVecino = onCall(
  { region: "us-central1", maxInstances: 20, enforceAppCheck: true },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Inicia sesión para continuar.");
    }

    const user = await obtenerDocumentoVecinoVinculado(request.auth.uid);
    const data = user.data();
    return {
      nombre: typeof data.nombre === "string" ? data.nombre : "",
      haVotado: data.haVotado === true
    };
  }
);

exports.obtenerResultadosSeguimiento = onCall(
  { region: "us-central1", maxInstances: 10, enforceAppCheck: true },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Inicia sesión para consultar los resultados.");
    }

    if (request.auth.token.resultsViewer !== true) {
      throw new HttpsError("permission-denied", "No tienes permiso para consultar el panel de resultados.");
    }

    const ahora = new Date();
    const horaActual = new Date(Date.UTC(
      ahora.getUTCFullYear(),
      ahora.getUTCMonth(),
      ahora.getUTCDate(),
      ahora.getUTCHours()
    ));
    const horaMinima = new Date(horaActual.getTime() - 23 * 60 * 60 * 1000);
    const [propuestas, totalUsuarios, usuariosParticipantes, actividadHoraria, primerRegistro] =
      await Promise.all([
        db.collection("propuestas").get(),
        db.collection("usuarios").count().get(),
        db.collection("usuarios").where("haVotado", "==", true).count().get(),
        db.collection("participacionPorHora")
          .where("horaInicio", ">=", Timestamp.fromDate(horaMinima))
          .orderBy("horaInicio", "asc")
          .get(),
        db.collection("participacionPorHora").orderBy("horaInicio", "asc").limit(1).get()
      ]);
    const resultados = propuestas.docs.map((documento) => {
      const data = documento.data();
      const votos = Number(data.conteoVotos ?? 0);

      if (!Number.isSafeInteger(votos) || votos < 0) {
        throw new HttpsError("failed-precondition", "Una propuesta tiene un conteo de votos no válido.");
      }

      return {
        titulo: typeof data.titulo === "string" ? data.titulo : "Propuesta sin título",
        votos
      };
    });
    const totalVotos = resultados.reduce((total, resultado) => total + resultado.votos, 0);

    if (!Number.isSafeInteger(totalVotos)) {
      throw new HttpsError("failed-precondition", "El total de votos no es válido.");
    }

    const registrados = totalUsuarios.data().count;
    const participantes = usuariosParticipantes.data().count;
    if (!Number.isSafeInteger(registrados) || !Number.isSafeInteger(participantes) ||
        participantes > registrados) {
      throw new HttpsError("failed-precondition", "El conteo de participación no es válido.");
    }

    const votosPorHora = new Map(
      actividadHoraria.docs.map((documento) => {
        const data = documento.data();
        const hora = data.horaInicio.toDate().toISOString();
        const votos = Number(data.votos);
        if (!Number.isSafeInteger(votos) || votos < 0) {
          throw new HttpsError("failed-precondition", "El historial horario contiene un conteo inválido.");
        }
        return [hora, votos];
      })
    );
    const historialDesde = primerRegistro.empty
      ? null
      : primerRegistro.docs[0].get("horaInicio").toDate().toISOString();
    const inicioSerie = historialDesde
      ? Math.max(horaMinima.getTime(), new Date(historialDesde).getTime())
      : horaActual.getTime();
    const serieHoraria = [];
    for (let hora = inicioSerie; hora <= horaActual.getTime(); hora += 60 * 60 * 1000) {
      const horaISO = new Date(hora).toISOString();
      serieHoraria.push({ hora: horaISO, votos: votosPorHora.get(horaISO) ?? 0 });
    }

    return {
      generadoEn: ahora.toISOString(),
      totalVotos,
      participacion: {
        registrados,
        participantes,
        pendientes: registrados - participantes,
        porcentaje: registrados === 0 ? 0 : (participantes / registrados) * 100
      },
      serieHoraria,
      historialDesde,
      propuestas: resultados.map((resultado) => ({
        ...resultado,
        porcentaje: totalVotos === 0 ? 0 : (resultado.votos / totalVotos) * 100
      }))
    };
  }
);

exports.registrarVoto = onCall(
  { region: "us-central1", maxInstances: 20, enforceAppCheck: true },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Inicia sesión para votar.");
    }

    const idPropuesta = request.data?.idPropuesta;
    if (typeof idPropuesta !== "string" || idPropuesta.length === 0) {
      throw new HttpsError("invalid-argument", "La propuesta no es válida.");
    }

    const user = await obtenerDocumentoVecinoVinculado(request.auth.uid);
    const userRef = user.ref;
    const proposalRef = db.collection("propuestas").doc(idPropuesta);
    const ahora = new Date();
    const horaInicio = new Date(Date.UTC(
      ahora.getUTCFullYear(),
      ahora.getUTCMonth(),
      ahora.getUTCDate(),
      ahora.getUTCHours()
    ));
    const horaId = horaInicio.toISOString().slice(0, 13).replace(/[-T]/g, "");
    const horaRef = db.collection("participacionPorHora").doc(horaId);

    await db.runTransaction(async (transaction) => {
      const [userSnapshot, proposalSnapshot, horaSnapshot] = await Promise.all([
        transaction.get(userRef),
        transaction.get(proposalRef),
        transaction.get(horaRef)
      ]);

      if (!userSnapshot.exists || !proposalSnapshot.exists) {
        throw new HttpsError("not-found", "No se encontró el vecino o la propuesta.");
      }
      if (userSnapshot.get("haVotado") === true) {
        throw new HttpsError("failed-precondition", "Este vecino ya registró su voto.");
      }

      const currentCount = Number(proposalSnapshot.get("conteoVotos") ?? 0);
      if (!Number.isSafeInteger(currentCount) || currentCount < 0) {
        throw new HttpsError("failed-precondition", "El conteo de votos no es válido.");
      }

      const votosHora = Number(horaSnapshot.get("votos") ?? 0);
      if (!Number.isSafeInteger(votosHora) || votosHora < 0) {
        throw new HttpsError("failed-precondition", "El conteo horario no es válido.");
      }

      transaction.update(userRef, { haVotado: true });
      transaction.update(proposalRef, { conteoVotos: currentCount + 1 });
      transaction.set(horaRef, {
        horaInicio: Timestamp.fromDate(horaInicio),
        votos: votosHora + 1
      });
    });

    return { registrado: true };
  }
);
