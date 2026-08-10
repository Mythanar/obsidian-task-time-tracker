# Changelog

Todos los cambios notables de este proyecto se documentan en este archivo.

El formato está basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).

## [Unreleased]

### Added

- Fase 5 — icono play/stop junto al checkbox de la tarea:
  - Al pasar el ratón por una tarea trackeable y abierta aparece un icono
    de play; si ya tiene sesiones guardadas, se muestra junto a su tiempo
    total acumulado. Un clic inicia el tracking (cerrando antes, sin
    confirmación, cualquier otra sesión activa, igual que ya hacía el
    comando).
  - La tarea con tracking activo muestra en su lugar un icono de stop,
    siempre visible (no depende de hover), con el tiempo total (acumulado
    previo + sesión en curso) actualizándose cada segundo. Un clic
    detiene el tracking, igual que el comando "Stop tracking" o que
    cerrar la tarea.
  - Las tareas cerradas (`[x]`/`[-]`) con tiempo acumulado muestran ese
    total de forma permanente, sin icono ni interacción (solo
    informativo); si nunca se trackearon, no se muestra nada.
  - Funciona igual en modo Edición (Live Preview) y en modo Lectura.

- Fase 5 — una tarea cerrada no se puede trackear:
  - Se considera "cerrada" únicamente `[x]` (hecha) o `[-]` (cancelada);
    cualquier otro estado (`[ ]`, `[/]` u otros personalizados de Tasks)
    se trata como abierto, igual que hoy.
  - Intentar iniciar tracking sobre una tarea cerrada no crea ninguna
    sesión; se avisa con un Notice.
  - Si la tarea con tracking activo se marca como `[x]` o `[-]` (por
    ejemplo al clicar el checkbox), el tracking se detiene solo y la
    sesión se guarda igual que con "Stop tracking" manual.
  - Reversible: al desmarcar una tarea cerrada de vuelta a `[ ]` (o
    cualquier estado abierto), se puede volver a trackear con
    normalidad; no hay memoria de que estuvo cerrada.

- Fase 5 — status bar: recorte de tarea, estado detenido y acceso al Historial:
  - El nombre de la tarea se corta a 40 caracteres, con puntos suspensivos.
  - Ya no queda vacío/oculto sin tracking activo: muestra icono + texto
    "Sin tracking activo".
  - Todo el status bar es clicable y abre el panel de Historial, tanto
    en estado activo como detenido — mismo resultado que el comando
    "Open time log panel".

- Fase 5 — rediseño del Historial (tarjetas, link a la nota, edición y
  borrado de sesiones):
  - Tarjetas de tarea expandibles: título con link a la nota (abre en
    pestaña nueva, o enfoca la existente si ya está abierta, con la
    línea de la tarea seleccionada) y resumen (nº de sesiones + total +
    `tt-id`); al expandir, detalle de sesiones individuales.
  - Edición inline de sesiones cerradas (fecha de inicio, hora de
    inicio, hora de fin, en `HH:MM:SS`, sin redondeos automáticos), con
    validación de formato y aviso de solapamiento con otra sesión
    guardada, ambos en línea (sin toast) y sin bloquear mientras se
    sigue escribiendo.
  - Borrado de sesión individual con confirmación explícita que
    mantiene visibles los datos de la sesión mientras se confirma.
  - Borrado de una tarea completa (icono de papelera en el resumen de
    la tarjeta): elimina todo el histórico de esa tarea por `tt-id`
    (incluidas sesiones de otras notas si el id está duplicado), sin
    tocar el `[tt-id:: ...]` que quede en la nota. Bloqueado mientras
    esa tarea tenga la sesión activa en ese momento.

- Fase 5 — navegación por fecha en el Historial y ubicación configurable
  del panel:
  - El Historial muestra por defecto solo el día actual, con vista
    diaria (flechas día a día) y vista semanal (lunes a domingo,
    flechas semana a semana), y botón "Hoy" para volver a la fecha
    actual desde cualquier punto de la navegación.
  - El total de cada tarjeta de tarea refleja solo el rango de fecha
    visible (cambia al navegar) — distinto del badge del checkbox, que
    sigue mostrando el total histórico completo.
  - Nuevo ajuste en Settings: elegir si el Historial se abre como panel
    lateral o como pestaña en el área central; si se cambia mientras ya
    está abierto, aplica la próxima vez que se abra.

- Fase 5 — rediseño del diálogo de exportación y carpeta de exportación
  configurable:
  - El selector de formato "CSV para Toggl" deja de bloquearse; siempre
    es seleccionable. Si el email de Toggl no es válido, el modal
    muestra un campo editable ahí mismo, con aviso en línea y el botón
    "Exportar" desactivado hasta que sea válido. Al confirmar, el email
    se guarda también en Settings > Toggl > Email (única fuente de
    verdad).
  - Nuevo ajuste en Settings: carpeta de destino de ambos formatos de
    exportación, con autocompletado de carpetas ya existentes en la
    vault y creación automática si la ruta no existe todavía. Valor por
    defecto `task-tracker-exports`, igual que antes.

- Fase 5 — botón "Exportar todo" en Settings:
  - Exporta con un clic todo el histórico a CSV genérico (nunca Toggl),
    sin modal ni selección de rango/formato, en la carpeta de
    exportación configurada. Excluye la sesión activa igual que el
    resto de exportaciones.

- Fase 1 — MVP de tracking local:
  - Comando "Time Tracker: Start tracking on current task": inicia el
    tracking sobre la tarea (checkbox) donde está el cursor; si había otro
    timer activo, lo cierra automáticamente antes de arrancar el nuevo.
  - Comando "Time Tracker: Stop active tracking": cierra la sesión activa;
    avisa con un Notice si no hay ninguna corriendo.
  - Comando "Time Tracker: Open time log panel": abre un panel lateral con
    la lista cronológica simple de todas las sesiones guardadas.
  - Indicador en la status bar con la tarea activa y el tiempo transcurrido,
    actualizado cada segundo.
  - Persistencia de sesión activa e historial vía saveData/loadData (sin
    escribir estado interno en las notas del usuario).
  - Recuperación al reabrir Obsidian: si queda una sesión marcada como
    activa de un cierre anterior, se pregunta explícitamente si cerrarla
    ahora o dejarla corriendo.
  - `CHANGELOG.md` y `docs/DECISIONES.md` para llevar registro de cambios y
    decisiones de producto/arquitectura.

- Fase 2 — vinculación robusta de tareas:
  - Al iniciar tracking sobre una tarea, si la línea no tiene todavía un
    identificador `tt-id::`, se le añade uno automáticamente al final.
  - El vínculo entre sesiones y tarea pasa a ser exclusivamente ese
    identificador (ya no el texto de la tarea ni la ruta del archivo).
  - El panel de historial resuelve cada sesión buscando su `tt-id::` en
    todo el vault; si la línea ya no existe, la sesión se conserva y se
    muestra como "Tarea no encontrada" en vez de descartarse.
  - Si el mismo `tt-id::` aparece copiado en más de una línea, todas
    cuentan como la misma tarea a efectos de tiempo acumulado (sin
    resolución de conflictos en esta fase).
  - El panel de historial muestra el `tt-id::` de cada sesión y un total
    de tiempo acumulado agrupado por tarea, además de la lista
    cronológica ya existente.
  - El bloque "Total acumulado por tarea" usa el mismo formato de
    tarjeta que el de "Sesiones": una por tarea, con nombre, `tt-id::`,
    número de sesiones y tiempo total.

- Fase 3 — exportación manual a CSV:
  - Comando "Time Tracker: Export time entries...": abre un modal para
    elegir un rango de fechas (desde/hasta) y exporta a CSV.
  - Columnas del CSV: fecha, hora inicio, hora fin, duración, tarea,
    nota de origen (ruta del archivo) y `tt-id`.
  - El archivo se guarda en `/task-tracker-exports/` dentro del vault
    (se crea automáticamente si no existe), con nombre
    `task-tracker-export_YYYY-MM-DD_HHmmss.csv` según la fecha/hora de la
    exportación.
  - Solo se exportan sesiones cerradas (con hora fin); la sesión activa
    se excluye hasta que se detenga.
  - Las sesiones que cruzan la medianoche se agrupan según su fecha de
    inicio, sin dividirse entre dos días.
  - Cada exportación genera un archivo nuevo e independiente; no hay
    fusión ni comprobación de duplicados contra exportaciones previas.

- Fase 4 — exportación CSV para el importador nativo de Toggl:
  - `TogglCsvAdapter.ts`: genera un CSV con las columnas Email,
    Description, Start date, Start time, Duration (sin Task, Billable,
    Client ni Project). No llama a la API de Toggl en ningún momento.
  - Nombre de archivo `toggl-export_YYYY-MM-DD_HHmmss.csv`, en la misma
    carpeta `/task-tracker-exports/`. Mismas reglas que el CSV genérico:
    solo sesiones cerradas, agrupadas por fecha de inicio.
  - Nueva página de ajustes (Settings → Task Time Tracker): sección
    "Toggl" con email de la cuenta (obligatorio para este formato),
    formato de fecha (ISO / DD-MM-AAAA / MM-DD-AAAA) y formato de hora
    (24h / 12h) — todos campos manuales, sin token ni credenciales.
    Sección general sin encabezado propio, como placeholder para Fase 5.
  - En el modal de exportación, selector de formato ("CSV genérico" /
    "CSV para Toggl"); la opción de Toggl aparece deshabilitada con un
    aviso si el email no está configurado en ajustes.

### Changed

- El identificador inline cambia de `tt-id:: <id>` a `[tt-id:: <id>]`
  (con corchetes), la sintaxis que Dataview necesita para reconocerlo
  como inline field estructurado. Afecta a la generación, lectura y
  eliminación del identificador en todo el plugin (start/stop, panel de
  historial, exportación CSV).
- El id generado pasa de timestamp + sufijo aleatorio (~23 caracteres) a
  un nanoid alfanumérico de 8 caracteres.
- **Reset de datos:** se vació `data.json` (historial de sesiones y
  timer activo) al hacer este cambio; no se migran las entradas
  antiguas. Las líneas `tt-id::` sueltas que queden en notas de prueba
  con el formato viejo no se tocan automáticamente.
- La columna de identificador del CSV exportado pasa a llamarse `tt-id`
  (antes `tt-id::`), ya que el valor que contiene es siempre el id
  limpio, sin corchetes ni el separador `::`.
- `TimeEntry` ya no guarda `filePath`; guarda `taskId` como fuente de
  verdad para el vínculo con la tarea.
- Los timestamps de tracking (`start`/`end`) se redondean a segundos
  completos directamente en `TrackingEngine.start()`/`stop()`,
  eliminando los milisegundos del dato desde el origen; resuelve
  desajustes de duración entre pantallas (lista vs. edición) que no se
  conseguían arreglar de forma estable ajustando solo el cálculo o la
  visualización. `data.json` se reseteó al aplicar este cambio (datos
  de prueba, mismo criterio que el reset de Fase 2).

### Fixed

- El auto-stop al cerrar una tarea (`[x]`/`[-]`) tardaba 2-3 segundos en
  modo Edición, aunque era instantáneo en modo Lectura. Causa: solo se
  escuchaba `vault.on("modify")`, que en modo Edición no se dispara
  hasta que Obsidian vuelca el editor a disco (debounce interno de
  Obsidian, ajeno al plugin). Ahora también se escucha
  `workspace.on("editor-change")`, leyendo el contenido en vivo del
  editor con un debounce propio corto (300 ms) para no reaccionar a un
  estado `[x]`/`[-]` transitorio mientras la línea sigue en edición.
  `vault.on("modify")` se mantiene como respaldo para cambios que no
  pasan por un editor abierto (edición externa, sync entre
  dispositivos).
- El detector de tareas trackeables (`parseCheckboxLine`) solo reconocía
  la viñeta `- [ ]`. Ahora también reconoce `* [ ]`, `+ [ ]` y listas
  numeradas (`1. [ ]`, `2. [ ]`, ...), indentadas o no. Sin cambios en
  el resto del flujo: el vínculo sigue siendo por `[tt-id:: <id>]`, no
  por posición ni número de lista, así que renumerar una lista no rompe
  el vínculo con sesiones guardadas ni con un timer activo.
- El campo de email en ajustes de Toggl solo comprobaba que no estuviera
  vacío, no que tuviera formato de email válido. Ahora se valida contra
  un patrón mínimo (`algo@algo.algo`, sin espacios ni caracteres
  especiales sueltos como `< > ! * { } / ( )`) — validación básica para
  evitar errores tontos antes de exportar, no un sustituto de la
  validación real que hace Toggl al importar. Si el formato no es
  válido, el propio campo de ajustes muestra un aviso, y la opción "CSV
  para Toggl" del modal de exportación queda deshabilitada igual que
  cuando el campo está vacío.
- El nombre de archivo de ambas exportaciones (CSV genérico y CSV para
  Toggl) no incluía los segundos (`..._YYYY-MM-DD_HHmm.csv`), así que
  exportar dos veces dentro del mismo minuto hacía fallar la segunda
  exportación porque el archivo ya existía. Ahora el patrón incluye
  segundos (`..._YYYY-MM-DD_HHmmss.csv`).
- El motor de tracking abría una segunda sesión en paralelo al iniciar
  tracking sobre una tarea que ya se estaba trackeando activamente
  (mismo `tt-id::`). Ahora esa acción se ignora: el timer exclusivo no
  se reinicia si la sesión activa ya es la misma tarea.
- La "nota de origen" de una sesión (ruta del archivo) se recalculaba en
  cada lectura buscando la ubicación *actual* del `tt-id::`, así que al
  trackear la misma tarea desde una nota distinta, todas las sesiones
  anteriores de esa tarea (ya cerradas) mostraban la ruta nueva en vez de
  la que tenían al registrarse. Ahora `TimeEntry.filePath` es un snapshot
  inmutable tomado al iniciar cada sesión, y la exportación CSV lo usa
  directamente en vez de resolverlo en el momento de exportar.
- El panel de historial mostraba "Tarea no encontrada" para la tarea que
  se estaba trackeando activamente, hasta detener el timer. Causa: la
  resolución del `tt-id::` leía el contenido de las notas vía
  `vault.cachedRead`, que no refleja los cambios hechos por la API de
  Editor hasta que Obsidian los guarda a disco (hay un pequeño delay).
  Ahora, para notas abiertas, se lee el contenido en vivo del editor.
- Fix ortográfico: "sesiónes" → "sesiones" (era un bug de interpolación
  de plural, no un typo literal).
- En el modal de exportación, el campo de email de Toggl desaparecía en
  cuanto el usuario escribía un valor válido y el campo perdía el foco,
  porque su visibilidad dependía de la validez del email a mitad de la
  interacción. Ahora la visibilidad del campo depende solo del formato
  seleccionado (Toggl); solo el aviso y el botón "Exportar" siguen
  reaccionando a la validez.

## [0.0.1] - 2026-08-08

### Added

- Fase 0 — scaffold inicial del plugin (basado en obsidian-sample-plugin)
  con la estructura de carpetas del roadmap.