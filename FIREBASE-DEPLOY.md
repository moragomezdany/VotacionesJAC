# Acceso de vecinos y despliegue seguro

La aplicación usa correo y contraseña de Firebase Authentication. Cloud Functions enlaza la cuenta autenticada con un documento de `usuarios` mediante el campo `authUid`; el cliente nunca lee `usuarios` ni escribe directamente los votos.

## Enlazar una cuenta existente

1. En Firebase Console, abre **Authentication > Users** y copia el UID completo de la cuenta de correo del vecino.
2. Abre **Firestore Database > usuarios** y localiza manualmente el documento del vecino correcto. No lo elijas por una coincidencia aproximada ni compartas datos personales en capturas.
3. Agrega al documento el campo `authUid`, de tipo **string**, con el UID completo copiado de Authentication.
4. Asegúrate de que una sola cuenta de Authentication esté vinculada a cada perfil y que un perfil tenga un solo `authUid`.
5. El vecino inicia sesión en la página con el correo y la contraseña de **Authentication**. El PIN del campo antiguo `contrasena` ya no es la contraseña de acceso.

Un usuario de Authentication no queda enlazado automáticamente con Firestore. La cédula numérica antigua no permite inferir de forma segura qué correo pertenece a qué vecino. La cuenta mostrada en la consola solo podrá entrar si se vincula al perfil correcto. Si es una cuenta administrativa y no pertenece a un vecino, no la vincules a un perfil de votante.

Cada vecino debe tener su propia cuenta de Authentication con acceso por correo/contraseña habilitado; no reutilices una sola cuenta para todos los votantes.

Los registros viejos pueden conservar `cedula` como número y el campo `contrasena`; el cliente ya no los consulta. Después de verificar la migración de cada vecino, elimina `contrasena` del documento para no conservar el PIN en texto. No conviertas ni compartas esos PIN.

## Panel de seguimiento de resultados

El panel es una vista separada, de solo lectura, para cuentas de Authentication con el custom claim `resultsViewer: true`. La función `obtenerResultadosSeguimiento` valida el claim y App Check en el servidor y devuelve títulos y conteos de propuestas, participantes y pendientes, además de conteos agregados por hora. No devuelve perfiles, identificadores de votantes ni votos individuales. La interfaz actualiza los datos cada 30 segundos y permite actualizar manualmente, descargar una instantánea CSV, imprimir/guardar el informe como PDF o cerrar la sesión.

La gráfica de dona compara perfiles registrados en `usuarios` con perfiles cuyo campo `haVotado` es `true`. Desde la publicación del registro horario, cada voto confirmado incrementa de forma transaccional un único contador agregado UTC en `participacionPorHora`; no se guarda una fila de voto ni una relación entre votante y propuesta en esa colección. La gráfica de línea muestra las últimas 24 horas desde el primer intervalo horario registrado. No se puede reconstruir actividad previa al despliegue de este mecanismo; los conteos antiguos siguen incluidos en las barras y en la dona.

Para autorizar a un observador:

1. Crea una cuenta separada para la persona observadora en **Authentication > Users**. No reutilices la cuenta de un votante.
2. En Cloud Shell autenticado con una cuenta administrativa del proyecto, instala `firebase-admin` en una carpeta temporal o de trabajo y ejecuta este script, reemplazando el UID por el de esa cuenta:

   ```js
   const { initializeApp, applicationDefault } = require("firebase-admin/app");
   const { getAuth } = require("firebase-admin/auth");

   initializeApp({
     credential: applicationDefault(),
     projectId: "votaciones-jac"
   });

   async function autorizarObservador() {
     const auth = getAuth();
     const usuario = await auth.getUser("UID_DE_LA_CUENTA_OBSERVADORA");
     await auth.setCustomUserClaims(usuario.uid, {
       ...usuario.customClaims,
       resultsViewer: true
     });
     console.log("Cuenta autorizada para el panel de resultados.");
   }

   autorizarObservador().catch((error) => {
     console.error("No se pudo autorizar el observador:", error);
     process.exitCode = 1;
   });
   ```

3. Despliega las funciones con `firebase deploy --only functions --project votaciones-jac` y publica `index.html`, `js/`, y `css/` en el hosting.
4. La cuenta observadora debe cerrar sesión e ingresar de nuevo para recibir el custom claim. Usará el mismo formulario de acceso; el servidor la enviará al panel si está autorizada. Para revocar el acceso, elimina el claim `resultsViewer` mediante Admin SDK y fuerza la renovación/cierre de la sesión.

El CSV y el informe PDF son instantáneas de los datos consultados. El contador por hora es agregado y no constituye un ledger inmutable ni permite verificar modificaciones manuales de los conteos.

## Configuración previa

1. Habilita el plan Blaze si el proyecto lo requiere para desplegar Cloud Functions; puede generar cargos.
2. En **Authentication > Sign-in method**, habilita **Email/Password**.
3. En **Authentication > Settings > Authorized domains**, agrega el dominio real de la aplicación.
4. En Firebase App Check, abre **Apps > App Web JAC > Fraud Defense** y confirma que `appCheckSiteKey` en `js/firebase-config.js` sea exactamente la misma clave de sitio registrada. La clave debe pertenecer a esta app web y tener permitido el dominio real.
5. Prepara una ventana de mantenimiento: las reglas nuevas hacen incompatible el cliente antiguo.

## Despliegue

Desde la raíz del repositorio:

```sh
npm --prefix functions install
npm --prefix functions run check
firebase deploy --only functions,firestore:rules
```

Publica también `index.html`, `js/` y `css/` en el hosting actual. El cliente y App Check deben usar la misma clave Enterprise. No se necesita añadir un script `enterprise.js` ni llamar a `grecaptcha.enterprise.execute` manualmente: Firebase App Check adjunta el token a las llamadas HTTPS Callable.

La cuenta de servicio de ejecución de Cloud Functions debe tener el rol **Usuario de Cloud Datastore** (`roles/datastore.user`) en el proyecto para que el SDK Admin pueda consultar perfiles y registrar votos en Firestore. En este proyecto las funciones usan `140975550876-compute@developer.gserviceaccount.com`. Sin ese permiso, la verificación de la solicitud puede aprobarse y aun así Firestore devolver `PERMISSION_DENIED`, que la callable muestra como error interno. No cambies el acceso IAM público de las funciones: conserva la verificación Firebase Authentication y App Check configurada en el código.

### Pruebas en localhost

La configuración local activa `FIREBASE_APPCHECK_DEBUG_TOKEN` solo si el host es `localhost`, `127.0.0.1` o `::1`. Al cargar la página, copia el token que Firebase imprime en la consola del navegador y regístralo en **Firebase Console > App Check > Apps > App Web JAC > administrar tokens de depuración**. Recarga después la app. Un error HTTP 403 al intercambiar `exchangeDebugToken` indica que ese token no está registrado para la app correcta o fue revocado.

El token de depuración es secreto: no lo compartas ni lo subas al repositorio. No desactives `enforceAppCheck` y no configures el token de depuración en el dominio de producción.

### Si el endpoint responde 404 después del despliegue

Un error CORS acompañado de HTTP 404 indica que no hay una revisión de la función sirviendo en esa URL. El 16 de octubre de 2026 se desplegaron correctamente `obtenerPerfilVecino` y `registrarVoto` en `us-central1`; ambas aparecen `ACTIVE`. Cloud Build necesitó permisos de lectura y escritura de Artifact Registry para la cuenta de servicio de Compute Engine indicada abajo.

1. En Google Cloud Console, abre **Cloud Storage > Buckets** en el proyecto `votaciones-jac`.
2. Busca el bucket `gcf-v2-sources-140975550876-us-central1`, abre sus permisos y selecciona **Conceder acceso**.
3. Agrega como principal `140975550876-compute@developer.gserviceaccount.com` y asigna **Visualizador de objetos de Storage** (`roles/storage.objectViewer`). El error del build `e7db9315-4c70-45e0-afd6-306cb89be57c` indica que esa cuenta no puede leer el archivo fuente de la función. Conceder el rol en el bucket es más limitado que en todo el proyecto.
4. El build anterior también pidió **Escritor de registros** (`roles/logging.logWriter`) para el mismo principal. Asegúrate de que ese permiso siga concedido en el proyecto.
5. Para que Cloud Build pueda descargar y publicar la imagen de la función, concede **Escritor de Artifact Registry** (`roles/artifactregistry.writer`) a `140975550876-compute@developer.gserviceaccount.com`. El rol de lector no basta: el build `61403438-a3f3-4148-94de-725f5b5e905a` confirmó que falta `artifactregistry.repositories.uploadArtifacts`. En **IAM y administración > IAM**, edita los roles de esa cuenta de servicio ya existente; no la agregues por segunda vez. Si puedes administrar permisos directamente en el repositorio `gcf-artifacts`, limita el rol a ese repositorio; de lo contrario, concédelo a nivel de proyecto.
6. Vuelve a Cloud Build, abre el build más reciente y pulsa **Reintentar compilación**. Si la compilación termina pero la función sigue respondiendo 404, vuelve a desplegar:

   ```sh
   npx firebase-tools deploy --only functions --project votaciones-jac
   ```

7. Comprueba que ambas funciones aparezcan activas en `us-central1` con `npx firebase-tools functions:list --project votaciones-jac`. Una solicitud GET directa con `curl` no sirve para probar una HTTPS Callable: la respuesta 403 sin autenticación es esperada. Prueba el flujo desde la aplicación con Firebase SDK; si falla, verifica App Check y el vínculo `authUid`.

Si no puedes cambiar los permisos del bucket o no aparece **Conceder acceso**, un administrador debe conceder el rol. Si el proyecto usa VPC Service Controls, también hay que permitir el acceso del servicio de compilación al bucket dentro del perímetro. No otorgues estos roles a tu usuario personal: el error requiere darlos a la cuenta de servicio de compilación indicada arriba.

## Protección de datos y votos

Las reglas permiten leer propuestas solo a usuarios autenticados y bloquean el acceso directo desde clientes a `usuarios` y las escrituras de propuestas. Las funciones solo devuelven el nombre y el estado del voto del perfil vinculado, y registran el voto de forma atómica.

Si las reglas anteriores permitieron lecturas públicas, considera expuestos los PIN antiguos y elimínalos o cámbialos. App Check reduce llamadas automatizadas, pero no sustituye las reglas ni la vinculación explícita de la cuenta.
