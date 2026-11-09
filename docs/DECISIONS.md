# Decisiones de producto y arquitectura

Registro breve de decisiones cerradas: qué se decidió, por qué, y en qué
fase/fecha. Cada vez que se cierra una decisión nueva en el chat, se añade
una entrada aquí.

## Fase 0

- **Local-first no negociable.** Ningún flujo de start/stop de tracking
  depende de red; la exportación a plataformas externas es siempre push
  manual o por lotes, nunca sync en tiempo real. Motivo: el tracking de
  tiempo debe funcionar siempre, incluso offline, y no se quiere generar
  tráfico de red ni acoplamiento a servicios externos como parte del flujo
  principal.
- **Estado en `data.json`, no en las notas.** El modelo de datos vive en
  `data.json` del plugin (saveData/loadData), sin escribir estado interno
  en las notas del usuario, salvo el identificador inline que se añadirá en
  Fase 2 para vincular tarea↔sesión de forma robusta. Motivo: evitar
  ensuciar las notas del usuario con metadata de tracking.

## Fase 1

- **Timer exclusivo.** Un solo timer activo a la vez; al iniciar uno nuevo,
  el anterior se cierra automáticamente (sin confirmación) y su tiempo se
  guarda completo, sin pérdida de datos. Motivo: simplifica el modelo
  mental (no hay tracking paralelo) y evita que el usuario tenga que
  gestionar manualmente el cierre de sesiones previas cada vez que cambia
  de tarea.
- **Recuperación al reabrir Obsidian (US6).** El plugin siempre pregunta
  (no recupera en silencio ni descarta) cuando detecta una sesión que
  quedó activa de un cierre anterior, con dos opciones: "Cerrar ahora" o
  "Seguir corriendo". Motivo: un cierre inesperado de Obsidian no debe
  perder ni falsear el tiempo trackeado; la decisión de qué hacer con esa
  sesión es del usuario. No se implementa aún una tercera opción de
  "cerrar en el último guardado" — queda en backlog.
- **Historial de Fase 1 sin agrupaciones.** El panel lateral (TimeLogView)
  muestra una lista cronológica simple de todas las sesiones guardadas,
  sin agrupar por día/tarea/nota ni filtros. Motivo: su único propósito en
  esta fase es verificar que el dato se está guardando bien; las
  agrupaciones avanzadas llegan en Fase 5.
- **Vínculo tarea↔sesión temporal.** En Fase 1 el vínculo entre una tarea y
  su sesión de tracking es el texto de la tarea (snapshot) + la ruta del
  archivo. Motivo: es suficiente para el MVP y evita implementar el
  identificador inline (`⏱id::`) antes de tener el flujo de tracking
  básico funcionando. El identificador robusto llega en Fase 2
  (`TaskIdentifier.ts`), donde también se resuelven conflictos de tareas
  editadas/borradas o duplicadas.
- **`minAppVersion` en 1.7.2.** Se sube desde 1.0.0 porque `TimeLogView`
  usa `Workspace.revealLeaf`, cuya firma actual (que devuelve `Promise`)
  requiere esa versión mínima de Obsidian.
- **Sin licencia por ahora.** No se añade archivo de licencia al repo;
  se decidirá más adelante si el proyecto se publica.

## Fase 2

- **Formato del identificador inline: `tt-id:: <id>`.** Se añade al final
  de la línea de la tarea (formato Tasks-like, similar a `📅 fecha`) la
  primera vez que se empieza a trackear, solo si la línea no lo tiene ya.
  Motivo: cierra el TODO pendiente desde Fase 0 sobre el formato exacto
  del identificador.
- **El vínculo tarea↔sesión es exclusivamente el `tt-id::`.** Deja de
  usarse el texto de la tarea + ruta del archivo como en Fase 1; `taskText`
  se conserva en cada `TimeEntry` solo como snapshot informativo, no como
  parte de la lógica de vínculo. Motivo: el texto cambia al editar la
  tarea y la ruta cambia si se mueve la nota; el `tt-id::` es estable
  frente a ambos.
- **Tarea no encontrada, nunca se descarta el histórico.** Si al resolver
  un `tt-id::` no se encuentra ninguna línea en el vault que lo contenga
  (la tarea fue borrada), las sesiones asociadas se siguen mostrando en el
  panel, marcadas como "Tarea no encontrada", junto con el snapshot de
  texto que tenían al iniciar el tracking. Motivo: no perder tiempo
  trackeado solo porque el usuario borró o reescribió la tarea.
- **Duplicados de `tt-id::` no se resuelven en esta fase.** Si el mismo
  id aparece en más de una línea (copy-paste entre notas, duplicados),
  `TaskIdentifier.resolve()` devuelve la primera coincidencia encontrada
  y no hay lógica de desambiguación. Motivo: no es necesario para el MVP;
  todas las líneas con ese id se tratan como la misma tarea a efectos de
  tiempo acumulado. Queda en backlog si se vuelve un problema real.
- **Icono junto al checkbox: fuera de alcance.** Se decide explícitamente
  no añadir ningún icono/botón visual junto a la tarea en esta fase;
  queda pendiente como una fase de UX aparte, sin fecha aún.

## Fase 3

- **Sin columna de proyecto.** El CSV no incluye una columna de proyecto;
  queda fuera de esta fase. Motivo: no hay todavía un concepto de
  proyecto en el modelo de datos (los `#tags` son parte del texto de la
  tarea, no un campo estructurado).
- **Cada exportación es un archivo nuevo e independiente.** No se
  fusiona ni se comprueba contra exportaciones previas si una sesión ya
  fue exportada antes (sin idempotencia ni `externalId` para este
  adapter). Motivo: decisión explícita del usuario para esta fase;
  evitar duplicados entre exportaciones sucesivas queda como
  responsabilidad del usuario. Esto es distinto de lo que hará
  `TogglAdapter.ts` en Fase 4, donde sí hará falta idempotencia por
  tratarse de una API externa con reintentos.
- **Sesiones que cruzan medianoche: se agrupan por fecha de inicio.**
  Igual que hace Toggl. Una sesión que empieza el día N y termina el día
  N+1 genera una sola fila en el CSV, fechada el día N, sin dividirse.
- **Solo se exportan sesiones cerradas.** La sesión activa (sin hora
  fin) se excluye del CSV hasta que se detenga. Motivo: exportar un
  registro sin cerrar no tiene sentido como dato definitivo.
- **Carpeta y nombre de archivo fijos.** `/task-tracker-exports/` dentro
  del vault (autocreada si no existe) y
  `task-tracker-export_YYYY-MM-DD_HHmm.csv` según el momento de la
  exportación. Motivo: previsibilidad; el usuario sabe siempre dónde
  buscar sus exports.

## Fase 3 — fixes posteriores

- **Iniciar tracking sobre la tarea ya activa no hace nada.** Si se
  ejecuta "Start tracking" sobre una tarea cuyo `tt-id::` ya es la
  sesión activa, `TrackingEngine.start()` lo detecta y devuelve
  `"already-active"` sin cerrar ni crear ninguna sesión. Motivo: el
  timer exclusivo (Fase 1) no distinguía "cambiar de tarea" de
  "repetir la misma tarea", y esto último no debe generar una sesión
  nueva ni reiniciar la que ya corre.
- **`filePath` vuelve al modelo de datos, como snapshot inmutable.** Se
  había quitado en Fase 2 a favor de resolver la ubicación vía `tt-id::`
  en el momento de leer/exportar. Eso corrompía el histórico: todas las
  sesiones de una tarea (incluidas las ya cerradas) mostraban la
  ubicación *actual* del `tt-id::` en vez de la que tenían al
  registrarse, así que trackear la misma tarea desde otra nota
  reescribía la "nota de origen" de sesiones pasadas. Ahora
  `TimeEntry.filePath` se fija una sola vez, al crear la sesión, y nunca
  se vuelve a tocar; la exportación CSV lo usa directamente. El vínculo
  tarea↔sesión sigue siendo exclusivamente el `tt-id::` (no cambia nada
  de Fase 2) — este campo es solo un dato histórico de esa sesión en
  particular, no se usa para resolver ni para el vínculo.

## Fase 2 — formato final del identificador

- **`[tt-id:: <id>]`, con corchetes.** Se cambia desde `tt-id:: <id>`
  (sin corchetes) porque Dataview solo reconoce un `clave:: valor` como
  inline field estructurado (consultable con `dv.pages()...tt-id`, etc.)
  si va entre corchetes; sin ellos es texto plano para Dataview. Motivo:
  mantener la posibilidad de que el usuario consulte sus tareas
  trackeadas con Dataview más adelante, sin tener que re-touchear el
  formato otra vez.
- **ID nanoid alfanumérico de 8 caracteres**, en vez de timestamp +
  sufijo aleatorio (~23 caracteres). Motivo: el id se escribe inline en
  las notas del usuario; cuanto más corto, menos ensucia la tarea
  visualmente. 8 caracteres alfanuméricos (62^8 combinaciones) es de
  sobra para el volumen de tareas de un vault personal.
- **Reset de datos al cambiar de formato, sin migración.** Al aplicar
  este cambio se vació `data.json` (historial y timer activo) en vez de
  escribir un migrador que reescribiera `tt-id::` a `[tt-id:: ]` en
  todas las notas. Motivo: decisión explícita del usuario; el proyecto
  estaba en fase de pruebas, sin datos reales que conservar. Las líneas
  `tt-id::` viejas que queden sueltas en notas de prueba se limpian a
  mano, el plugin no las toca.
- **Columna `tt-id` en el CSV (Fase 3) exporta el valor limpio.** Sin
  corchetes ni `::`, solo el id (ej. `a3f9k2mp`). Motivo: los corchetes
  y `::` son sintaxis de Obsidian/Dataview, no aportan nada en un
  archivo pensado para abrirse en Excel/Sheets.

## Fase 4 — redefinición completa

- **Se abandona el push automático a la API de Toggl.** La Fase 4 estaba
  definida originalmente como un `TogglAdapter.ts` con batch push,
  throttling y retry con backoff contra la API de Toggl Track. Se
  investigaron los endpoints y rate limits vigentes (paso obligatorio
  fijado desde el inicio del proyecto) y se confirmó que el límite de
  30 peticiones/hora que motivó el fracaso del intento anterior sigue
  existiendo en el plan Free (240/hora en Starter, 600/hora en
  Premium), por lo que un push automático seguiría necesitando la misma
  complejidad de fondo (throttling, reintentos, idempotencia contra una
  API externa) que ya causó problemas antes. Motivo: evitar reintroducir
  la causa raíz del fracaso anterior, no solo mitigarla.
- **Nuevo enfoque: generación de archivos compatibles con el importador
  nativo de cada plataforma**, empezando por Toggl. Se descubrió que
  Toggl ofrece un importador de CSV oficial (`support.toggl.com`,
  limitado a administradores del workspace) pensado exactamente para
  carga masiva de entradas de tiempo, sin pasar por la API. El usuario
  sube el archivo manualmente. Motivo: cumple el mismo principio no
  negociable del proyecto ("exportación es push unidireccional, manual,
  nunca sync en tiempo real") pero elimina de raíz la dependencia de
  red, el rate limit y la complejidad de reintentos/idempotencia contra
  una API externa.
- **Alcance ampliado a varias plataformas, no solo Toggl.** Al dejar de
  depender de ninguna API, se generaliza la Fase 4 para ofrecer
  generación de archivos compatibles con el importador de varias
  plataformas de time tracking. Candidatas para investigar y priorizar:
  Toggl (ya investigado), Clockify, Harvest, Everhour, Timely. Cada
  plataforma nueva requiere el mismo proceso ya seguido con Toggl antes
  de tocar código: confirmar el formato exacto que espera su importador
  (columnas, estructura, requisitos de cuenta/permisos).
- **Ya no aplica gestión de tokens/credenciales de API en el plugin.**
  Al no llamar a ninguna API externa en ningún adapter de exportación,
  no hace falta guardar ni manejar tokens de autenticación de ninguna
  plataforma en `SettingsTab.ts`.
- **Ya no aplica idempotencia vía `externalId` de una plataforma
  remota.** Cada adapter de exportación genera un archivo nuevo e
  independiente, igual que el `CsvAdapter.ts` de Fase 3; evitar
  duplicados al importar queda como responsabilidad del usuario y/o del
  propio importador de cada plataforma (Toggl, por ejemplo, ya
  deduplica por su cuenta filas idénticas con la misma fecha/hora de
  inicio).
- **La investigación ya hecha de la API de Toggl queda documentada,
  sin uso inmediato.** Por si en el futuro se retoma la idea de un push
  automático (no planeado actualmente): 30 peticiones/hora por usuario
  en plan Free para datos personales; para peticiones sobre un
  workspace/organización, el límite depende del plan (30/hora Free,
  240/hora Starter, 600/hora Premium, sin límite en Enterprise); ventana
  recomendada de 1 petición/segundo; algoritmo de ventana deslizante (no
  reseteo fijo en punto en punto); cierta inconsistencia documental
  entre código de error 429 y 402 según la fuente, pendiente de
  verificar en la práctica si algún día se retoma esta vía.

## Fase 4 — alcance y formato cerrados (9 de agosto de 2026)

- **Alcance de Fase 4: solo Toggl por ahora.** Clockify, Harvest,
  Everhour y Timely quedan en backlog explícito, sin fecha. Motivo:
  cerrar y entregar un adapter completo (Toggl) antes de repetir la
  investigación de formato de importador para cada plataforma nueva.
- **Columnas del CSV de Toggl: Email, Description, Start date, Start
  time, Duration.** Sin `Task` ni `Billable` (requieren un plan de pago
  de Toggl; el caso de uso objetivo es el plan Free) ni `Client`/
  `Project` (el plugin no tiene ese concepto en el modelo de datos
  todavía). Motivo: ajustarse exactamente a lo que el importador de
  Toggl acepta en Free y a lo que el plugin puede rellenar hoy sin
  inventar datos.
- **Email y formato de fecha/hora: campos manuales en una página de
  settings específica de Toggl.** Se descartó explícitamente
  consultarlos vía la API de Toggl, incluso en modo solo lectura,
  porque contradice la regla no negociable ya cerrada en la
  redefinición de Fase 4 ("el plugin nunca llama a ninguna API
  externa, en ningún punto del código"). Motivo: coherencia con esa
  regla por encima de la comodidad de autocompletar esos campos.
- **Nueva página de settings "General".** Se añade como placeholder
  pensado para Fase 5, sin contenido funcional todavía.

## Fase 4 — implementación

- **La sección "General" no lleva un encabezado literal "General".**
  Es la primera sección de `SettingsTab.ts`, sin `Setting(...).setHeading()`
  propio, seguida del encabezado "Toggl" para el resto. Motivo: la regla
  de lint `obsidianmd/settings-tab/no-problematic-settings-headings`
  desaconseja titular una sección "General" — la convención de Obsidian
  es que la primera sección sin título ya cumple ese rol. El resultado
  visual (dos áreas separadas) es el mismo que se pidió.
- **`PluginState` pasa a incluir `settings` junto a `entries`,
  persistidos como un único objeto.** `TrackingEngine` sigue recibiendo
  y mutando la misma referencia compartida (solo toca `.entries`), así
  que cualquier `saveData()` — venga de start/stop o de cambiar un
  ajuste de Toggl — persiste ambos sin pisarse. Motivo: Obsidian solo
  ofrece un `data.json` por plugin; evitar el bug de Fase 2/3 de
  sobrescribir datos al mezclar dos fuentes de verdad.
- **La opción "CSV para Toggl" se deshabilita en el `<option>` del
  desplegable** (vía `selectEl`, no solo validación al enviar) cuando el
  email de Toggl no está configurado, con una descripción explicando
  dónde completarlo. Se mantiene además una validación al enviar como
  respaldo. Motivo: cumplir literalmente "debe aparecer deshabilitada"
  y no solo fallar tarde con un aviso de error.

## Toggl settings — dateFormat/timeFormat removed pre-release

- **`TogglSettings` originally let the user pick a date/time format;
  those fields were removed before release.** Toggl's real CSV importer
  requires a fixed format (YYYY-MM-DD, 24h HH:MM:SS) and doesn't accept
  a user-chosen one, so the format is now fixed in
  `TogglCsvAdapter.ts`, not configurable. An older `data.json` carrying
  `dateFormat`/`timeFormat` keys leaves them as unused orphaned
  properties: not read, don't break loading, not migrated.

## Clockify settings — Project column is not actually required

- **The original research behind `ClockifySettings.includeProject` said
  Project was mandatory for Clockify's CSV importer; that finding was
  wrong** (corrected 2026-08-22, see `docs/Vault/Tareas/Clockify.md`).
  It came from Clockify's manual "Add time" form, not from the
  importer itself. `includeProject` exists on equal footing with
  `includeClient` — both opt-in, independent of each other, unchecked
  by default, same "clean vault by default" criterion as Toggl.


## Fase 5

- **Detección de tareas ampliada a las 4 viñetas válidas de Obsidian.**
  Hasta ahora el detector de tareas trackeables solo reconocía el formato
  con guión (`- [ ] Tarea`). Se corrige para reconocer también `* [ ]`,
  `+ [ ]` y listas numeradas (`1. [ ]`, `2. [ ]`...), estén o no
  indentadas (tareas anidadas). Motivo: eran formatos válidos de checkbox
  en Obsidian que quedaban fuera sin ninguna razón de producto, solo por
  una limitación del detector original. El vínculo tarea↔sesión sigue
  siendo por `tt-id` (Fase 2), por lo que la renumeración automática de
  las listas numeradas no afecta al histórico ni a un timer activo.

- **Tareas cerradas (`[x]` hecha o `[-]` cancelada) no se pueden
  trackear.** Si el timer está activo sobre una tarea y esta se marca
  como `[x]` o `[-]`, el tracking se detiene automáticamente y la sesión
  se guarda con normalidad, igual que un "Stop tracking" manual (inicio,
  fin, duración). Intentar iniciar tracking sobre una tarea ya cerrada no
  crea ninguna sesión. Motivo: no tiene sentido de producto seguir
  cronometrando (o empezar a cronometrar) una tarea que el usuario ya dio
  por terminada o cancelada. Ningún otro estado del plugin Tasks (`[/]`
  u otros estados personalizados) se ve afectado — se siguen tratando
  como "abiertos", igual que `[ ]`.
- **El bloqueo es reversible, sin memoria de estado previo.** Si una
  tarea cerrada se desmarca y vuelve a un estado abierto (`[ ]` u otro
  no-cerrado), recupera el comportamiento normal de tracking sin ninguna
  restricción residual. El histórico de sesiones ya guardadas antes del
  cierre no se modifica en ningún caso.
- **"Concepto de proyecto" sale del backlog de mejoras UX de Fase 5** y
  pasa a tratarse como su propia fase futura, sin fecha asignada aún. Se
  amplió su alcance original (definir si es tag/carpeta/campo) a incluir
  un segundo modo de tracking a nivel de nota completa y gestión de tags
  de tareas — suficientemente grande como para requerir su propio
  análisis de UX y arquitectura en vez de resolverse como un ítem de
  pulido.
- **Desinstalación del plugin: se mantiene la decisión de Fase 1 sin
  cambios.** Solo aviso/export de seguridad antes de desinstalar, sin
  borrado automático de datos. Se planteó revisar esta decisión durante
  la Fase 5 pero se confirma que sigue vigente tal cual.
- **Carpeta de exportación configurable: dentro de la vault, sin diálogo
  nativo del sistema.** El plugin no tiene acceso a explorar carpetas
  fuera de la vault (limitación de la API de Obsidian), así que la
  opción de "diálogo nativo del sistema" mencionada originalmente en el
  backlog se descarta. En su lugar, el usuario elige una carpeta dentro
  de la vault, con `task-tracker-exports` como valor por defecto (el
  mismo nombre que ya usa la carpeta fija de Fases 3-4).
- **Orden de prioridad del backlog de mejoras UX de Fase 5, tras el fix
  de detección de tareas:** (1) comportamiento con tareas completadas,
  (2) icono/botón junto al checkbox, (3) trim del nombre de tarea en el
  status bar, (4) rediseño del Historial (link a nota, sesiones
  expandibles, editar/borrar sesiones), (5) rediseño del diálogo de
  exportar (permitir seleccionar Toggl con datos incompletos y
  completarlos ahí mismo, en vez de bloquear la opción), (6) settings:
  carpeta de exportación configurable.
- **Auto-stop al cerrar una tarea: doble camino de detección, no solo
  `vault.on("modify")`.** Diagnosticado con logging temporal (con
  timestamps) antes de tocar código, no a ciegas: en modo Edición,
  `vault.on("modify")` solo se dispara cuando Obsidian vuelca el editor
  a disco, con un debounce interno de ~2s ajeno al plugin — confirmado
  midiendo el hueco entre `workspace.on("editor-change")` (el cambio en
  memoria) y `vault.on("modify")` (el guardado), consistentemente
  ~1.8-2.0s sea cual sea el carácter que cambia. En modo Lectura, el
  clic en el checkbox no pasa por el editor y escribe casi al instante.
  Se añade `workspace.on("editor-change")` como camino rápido (lee
  `editor.getValue()` en vivo), con un debounce propio corto (300ms)
  para no reaccionar a un estado `[x]`/`[-]` transitorio a mitad de una
  edición de la línea. `vault.on("modify")` se mantiene como respaldo
  para cambios que no pasan por ningún editor abierto (edición externa
  al vault, sync entre dispositivos). Ambos caminos verificados con un
  arnés de pruebas simulado (sin depender de Obsidian en ejecución): el
  respaldo funciona con contenido leído directamente, sin ningún objeto
  Editor involucrado; el debounce corto solo evalúa el contenido final
  tras una pausa de escritura, nunca un estado intermedio transitorio.
- **Icono/badge junto al checkbox para iniciar tracking sin comando.**
  Se añade un control visual al final de la línea de cada tarea (después
  del `tt-id::`), exclusivo de modo Edición — se decidió no dar soporte a
  modo Lectura, tratando el inicio de tracking como una acción propia del
  modo edición/fuente.
  - **Visibilidad:** por hover solo en el caso de una tarea abierta sin
    ningún historial (solo icono de play, sin contador). En cualquier
    otro caso con datos que mostrar, el badge es siempre visible sin
    depender del ratón: tarea abierta con historial (play + total
    acumulado), tarea con tracking activo (stop + contador en vivo,
    actualizado cada segundo), y tarea cerrada con historial (badge fijo
    informativo, sin icono ni interacción). Una tarea cerrada sin
    historial no muestra nada.
  - **El contador de la tarea es el total acumulado de todas sus
    sesiones**, distinto del status bar (Fase 1), que sigue mostrando
    solo el tiempo de la sesión activa — ambos indicadores conviven.
  - **Diseño:** badge tipo tag con fondo de color, usando las variables
    de tema de Obsidian (se adapta a temas claros/oscuros/personalizados
    en vez de colores fijos), con un tono distinto por estado
    (disponible-con-historial / activo / cerrado) e iconos de play/stop
    de tipo relleno.
  - **Timer exclusivo respetado:** iniciar tracking desde el icono de una
    tarea con otra ya activa cierra automáticamente la anterior, igual
    que ya ocurría vía comando.
  - **Backlog abierto:** caso límite de la misma nota abierta a la vez en
    dos paneles (Edición + Lectura) con cambios sin guardar — pendiente
    de que el usuario lo reproduzca en vivo antes de decidir si hace
    falta blindarlo, dado que el uso de doble panel es frecuente entre
    usuarios de Obsidian.

## Fase 5 — status bar (trim y clic para abrir el Historial)

- **Nombre de tarea recortado a 40 caracteres, con "…" solo cuando se
  recortó de verdad.** Motivo: nombres de tarea largos rompían el layout
  del status bar; el "…" condicional evita añadir el signo cuando el
  texto ya entraba completo sin recorte.
- **El status bar siempre muestra algo, incluso sin tracking activo**
  (icono + "Sin tracking activo" en reposo). Motivo: un status bar
  vacío no comunica que el plugin está cargado y funcionando.
- **Toda la barra es clicable y abre el panel de Historial**, tanto con
  tracking activo como en reposo, con efecto hover usando
  `var(--background-modifier-hover)` (variable de tema, no color fijo).
  Motivo: acceso directo al Historial sin pasar por el comando; mismo
  criterio de adaptación a temas claro/oscuro que el resto de Fase 5.

## Fase 5 — rediseño del Historial, Bloque 1 (tarjetas expandibles, edición y borrado inline)

- **El Historial pasa de lista cronológica plana a tarjetas de tarea
  expandibles.** Cada tarjeta muestra sesiones + total + tt-id en la
  cabecera, y al expandirse revela sus sesiones individuales. Motivo:
  con más historial acumulado, la lista plana de Fase 1 dejó de ser
  navegable.
- **El título de la tarjeta abre la nota de origen**, en una pestaña
  nueva del área central, con la línea de la tarea seleccionada unos
  instantes a modo de resaltado. Usa `TaskIdentifier.resolvePreferring()`
  (prioriza la nota de la sesión más reciente si el mismo tt-id está
  duplicado en varias notas, con el criterio genérico de Fase 2 como
  respaldo). Motivo: no existe una API pública de Obsidian para el flash
  de búsqueda nativo sin tocar el DOM interno; la selección de línea es
  la aproximación elegida.
- **Edición y borrado de sesiones se implementan en `main.ts` sobre
  `pluginState.entries` directamente, no en `TrackingEngine`.**
  `TrackingEngine` sigue limitado a timer activo/persistencia básica;
  `updateEntryTimes()`/`deleteEntry()` viven en `main.ts` y mutan la
  misma referencia de array que ya usa el motor. Motivo: decisión
  explícita para no ensanchar la responsabilidad de `TrackingEngine` con
  lógica de edición que solo necesita el panel.
- **Un clic fuera del formulario de edición no descarta los cambios** —
  solo Guardar/Cancelar/Eliminar lo hacen. El estado de edición
  (`EditDraft`) sobrevive a un re-render externo del panel (p. ej. si se
  inicia tracking en otra nota mientras se edita una sesión). Motivo: un
  refresh externo no debería tirar por la borda una edición en curso del
  usuario.
- **Edición de fecha/hora completamente libre, incluidos los segundos**
  (campos de texto `HH:MM:SS`, sin ningún redondeo automático). Se
  probaron y revirtieron dos reglas intermedias (forzar segundos a
  `:00` al guardar, y comparar por campo "tocado") antes de asentarse en
  esta versión definitiva. Motivo: cualquier redondeo automático
  generaba discrepancias entre la duración mostrada en la lista y la
  mostrada en el formulario de edición para una sesión sin tocar.
- **Aviso de solapamiento con otra sesión: en vivo mientras se edita,
  nunca bloqueante y nunca como `Notice`.** Se calcula del lado de
  `TimeLogView.ts` (no en `main.ts`) contra las entries actuales cada
  vez que cambia un campo. Motivo: reemplaza un enfoque anterior de
  confirmación al guardar; el usuario decide si el solapamiento es
  aceptable, el guardado nunca se impide por esto.
- **Mensajes de validación (formato inválido / solapamiento) en un
  único bloque fijo**, con prioridad estricta (error de guardado >
  formato inválido > fin≤inicio > solapamiento > nada, nunca dos a la
  vez) y altura reservada aunque esté vacío. El formato inválido no se
  evalúa en cada tecla: solo al perder el foco o al completar los 8
  caracteres de `HH:MM:SS`. Motivo: dos mensajes simultáneos en
  posiciones distintas eran confusos, y validar en cada tecla mostraba
  errores sobre un valor que el usuario todavía estaba escribiendo.
- **La confirmación de borrado mantiene visibles los datos originales
  de la sesión** (no lo que se haya tecleado sin guardar) mientras se
  confirma. Motivo: el usuario necesita ver qué sesión concreta está a
  punto de eliminar.

## Fase 5 — rediseño del Historial, Bloque 2 (navegación por fecha, ubicación del panel)

- **El Historial pasa a mostrar por defecto solo el día actual**, con
  navegación día/semana (flechas + botón "Hoy") en vez de todo el
  histórico de golpe. Cada apertura nueva del panel arranca siempre en
  "hoy" y en vista diaria, sin memoria de la última fecha/modo vistos en
  una apertura anterior — se apoya en que Obsidian crea una instancia
  nueva de `TimeLogView` cada vez que el panel se abre desde cerrado. El
  filtrado usa el día calendario local de `entry.start` (no de
  `entry.end`), así que una sesión que cruza medianoche se cuenta en el
  día en que empezó. Motivo: con meses de histórico acumulado, mostrarlo
  todo de golpe deja de ser útil.
- **Semana: lunes a domingo (convención ISO), agrupada en una sección
  por día**, cada una con sus propias tarjetas de tarea y un estado
  vacío ("Sin sesiones este día.") si no hubo actividad ese día.
- **El total de cada tarjeta queda acotado al rango de fecha visible
  (día o semana)**, distinto a propósito del total histórico completo
  que sigue mostrando el badge junto al checkbox (Fase 5, icono/badge).
  Motivo: son dos preguntas distintas ("cuánto llevo hoy/esta semana" vs.
  "cuánto llevo en total con esta tarea") y no tiene sentido forzar que
  coincidan.
- **Nuevo ajuste en settings: ubicación del Historial (panel lateral /
  pestaña central).** Cambiar el ajuste no mueve un panel ya abierto;
  solo aplica la próxima vez que se abra. Motivo: pedido explícito del
  usuario, con el mismo criterio de "no autoactuar sobre un panel ya
  abierto" que ya rige la edición/borrado de sesiones del Bloque 1.

## Fase 5 — botón "Exportar todo" en Settings

- **Exportación de un clic de todo el histórico, sin modal.** Se añade
  un botón "Exportar todo" en Settings que genera un CSV genérico
  (nunca el formato Toggl) con el rango completo, desde la primera
  sesión guardada hasta el momento de exportar, en la carpeta de
  exportación ya configurada. Reutiliza el mismo `exportToCsv()` que el
  resto de exportaciones, por lo que excluye la sesión activa igual que
  ellas; si no hay ninguna sesión guardada todavía, avisa con un
  `Notice` en vez de generar un archivo vacío. Motivo: se originó como
  salvaguarda ante una desinstalación del plugin — la API de Obsidian
  no permite interceptar ese momento exacto, así que no hay forma
  técnica de avisar "justo antes" — pero el texto visible del botón no
  menciona desinstalar en ningún momento, porque Obsidian ya preserva
  `data.json` por defecto al desinstalar (decisión de Fase 1);
  mencionarlo sería un aviso inexacto sobre un riesgo que no existe. Se
  presenta en cambio como buena práctica general de respaldo.

## Fase 5 — rediseño del formulario de edición inline de sesión

> ⚠️ **Cambio de decisión respecto al Bloque 1.** El Bloque 1 (más
> arriba) fijó que "la fecha de fin nunca se edita directamente: si la
> hora de fin es menor que la de inicio, se interpreta como cruce de
> medianoche". Esa decisión se revierte aquí: la fecha de fin pasa a ser
> un campo editable de verdad, ya no se infiere. Motivo del cambio:
> pedido explícito del usuario al rediseñar el formulario; el mecanismo
> de inferencia por comparación de horas no cubre sesiones que abarcan
> más de un día completo (p. ej. de un lunes a un miércoles), mientras
> que un campo de fecha de fin explícito sí, sin necesitar ningún caso
> especial adicional.

- **Los cuatro campos (fecha inicio, hora inicio, fecha fin, hora fin)
  pasan a ser texto libre, incluidas las fechas.** El campo de fecha de
  inicio deja de ser un `<input type="date">` nativo (selector del
  sistema) y pasa a validarse igual que ya se hacía con las horas: sin
  marcar error hasta que el usuario termine de escribir (blur o
  longitud completa), con el mismo `DATE_INPUT_REGEX` que ya existía
  pero hasta ahora solo se usaba para parsear, no para validar tecleo
  en vivo. Motivo: coherencia con el resto de campos del formulario y
  con el pedido explícito de no usar selectores nativos del sistema.
- **La fecha de fin se resuelve directamente del campo, sin inferencia
  por comparación de horas.** `resolveDraftTimestamps()` deja de tener
  un caso especial "si la hora de fin es menor, sumar un día"; ahora
  simplemente parsea `endDate` igual que `startDate`. El badge "+1" del
  formulario de edición desaparece (sigue existiendo en la fila estática
  de sesión y en las confirmaciones de borrado, que no cambiaron) —
  la propia fecha de fin visible ya comunica esa información con más
  claridad que un indicador "+1".
- **Nuevo bloque "Duración calculada", de solo lectura y resaltado
  visualmente**, en el lugar donde antes iba la vista previa de
  duración suelta junto a los campos. Motivo: dar más peso visual a un
  dato que antes quedaba como un número más entre los campos.
- **"Eliminar sesión" se separa de Guardar/Cancelar con una línea
  divisoria**, en vez de estar en la misma fila de botones. Motivo:
  reducir el riesgo de pulsación accidental sobre una acción
  irreversible, especialmente en pantalla táctil.
  > ⚠️ **Superado poco después, en la misma ronda de rediseño.** Se
  > vuelve a integrar en la fila de Guardar/Cancelar, como icono de
  > papelera (mismo icono ya usado para borrar una tarea completa desde
  > el Historial) alineado a la derecha, en vez de la línea divisoria de
  > más arriba. Motivo: pedido explícito del usuario tras ver el
  > formulario ya implementado, con el mismo criterio visual que el
  > borrado de tarea completa en vez de un patrón propio solo para
  > sesiones.
- **Bug corregido — contenido duplicado tras pulsar "Guardar".** Al
  guardar una edición de sesión, el panel del Historial llegaba a
  mostrar la lista de tareas duplicada. Causa raíz: condición de
  carrera entre dos llamadas a `render()` — `saveEditDraft()` lo invoca
  explícitamente, y `updateEntryTimes()` (en `main.ts`) ya lo dispara
  también de forma indirecta vía `refreshLogViews()`; al ser `render()`
  asíncrono, ambas invocaciones se solapaban y corrompían el DOM. Fix:
  un `renderToken` incremental que `render()` genera al empezar y que
  `renderDaySection()` comprueba tras su único punto `await`, abortando
  si ya existe una invocación más reciente en curso. El mismo patrón de
  carrera existía también en borrado de sesión y de tarea completa, no
  solo en Guardar, así que el fix cubre las tres a la vez en vez de
  parchear cada punto de llamada por separado.
- **Layout responsive por flexbox (`flex-wrap`), no media queries ni
  container queries.** Las dos parejas (inicio/fin) se apilan
  verticalmente si no caben una junto a otra, igual que ya hacía la
  barra de navegación de fecha del Historial. Motivo: mismo patrón ya
  usado en el plugin, sin depender de soporte de container queries en
  todos los entornos donde corre Obsidian (incluido mobile).
- **La lógica de validación no cambia salvo lo estrictamente necesario
  para el nuevo campo:** prioridad de mensajes, aviso de solapamiento
  en vivo, "clic fuera no descarta", persistencia del error de guardado
  del backend — todo igual que en Bloque 1. El único añadido de lógica
  real es que ahora hay cuatro campos evaluables en vez de tres
  (`{campo}Evaluated` por cada uno) y `effectiveRange()`, un helper
  nuevo que centraliza en un solo sitio el criterio de "usar el
  timestamp original si ese campo no se tocó" para los cuatro campos,
  antes duplicado a mano entre `updateMessage()` y `updatePreview()`
  para los tres campos que existían.

## Fase 5 — rediseño visual del badge play/stop (pill)

- **Colores derivados con `color-mix()` en vez de valores fijos.** El
  usuario aportó un mockup HTML/CSS de referencia con colores morados en
  `rgba(...)` fijos. Se tradujeron a
  `color-mix(in srgb, var(--interactive-accent) X%, transparent)` (con un
  `var(--interactive-accent)` plano declarado antes, como respaldo para
  motores sin soporte de `color-mix()`, relevante porque el plugin no es
  `isDesktopOnly` y debe funcionar también en Obsidian mobile). Motivo:
  regla no negociable del proyecto de no usar nunca colores fijos, para
  que el badge se adapte al accent real del tema activo del usuario en
  vez de quedar fijado al morado de la demo.
- **Texto/icono en `--interactive-accent` en los tres estados no
  estáticos (disponible, activo, con historial), no `--text-on-accent`.**
  El diseño nuevo usa fondos translúcidos (tintados, no rellenos sólidos)
  en forma de pill (`border-radius: 100px`); `--text-on-accent` (pensado
  para texto claro sobre un relleno sólido) sería ilegible sobre un fondo
  mayormente transparente. Coherente con el propio mockup del usuario,
  que tampoco cambia el color de texto entre sus estados idle/running/
  paused.
- **Punto pulsante nuevo como indicador de "en ejecución".** Se añade un
  punto (`.task-time-tracker-inline-dot`, con `@keyframes
  task-time-tracker-pulse`) visible solo mientras hay tracking activo,
  compartido entre el badge junto al checkbox (clase `.is-active`) y el
  botón de stop del Historial (donde siempre está en ejecución por
  definición, al renderizarse solo para la tarjeta de la tarea activa).
- **Icono de check para tareas cerradas con historial**, en vez de no
  mostrar ningún icono como hasta ahora. Motivo: mismo criterio visual
  que el mockup (estado "finished" con checkmark), da una señal visual
  de "completada" en vez de dejar el hueco vacío.
- **El componente `tt-check` del mockup (checkbox de la tarea) queda
  fuera de alcance.** El checkbox `- [ ]` lo renderiza el propio editor
  de Obsidian (Live Preview/Reading mode), no este plugin — el plugin
  solo dibuja el badge/pill que se añade después del `tt-id::`, así que
  restylear el checkbox en sí no es código de este proyecto.

## Fase 6 (futura) — Internacionalización (i18n)

- **Nueva fase añadida al roadmap: Fase 6 — Internacionalización.** El
  plugin se desarrolla en español pero debe publicarse con inglés como
  idioma por defecto, detectando el idioma configurado en Obsidian:
  si Obsidian está en español, el plugin se muestra en español; en
  cualquier otro caso (inglés incluido), se muestra en inglés. Motivo:
  ampliar el alcance de usuarios potenciales del plugin más allá de
  hispanohablantes, sin perder la experiencia nativa en español para
  quien ya lo use así.
- **Criterio de entrada: no se empieza hasta que Fase 5 esté cerrada.**
  Traducir antes sería traducir dos veces, ya que Fase 5 todavía añade
  textos nuevos (settings, diálogo de exportar rediseñado). Se coloca
  justo antes del release, no después.
- **Qué se traduce:** todo texto visible en la interfaz — comandos de
  la paleta, status bar, panel de Historial, modales, settings,
  mensajes de validación y avisos.
- **Qué NO se traduce (decisión explícita, para evitar que se cuele por
  descuido):** el identificador `[tt-id:: <id>]` inline en las notas
  (sintaxis interna, no contenido de usuario); las columnas del CSV
  genérico y del CSV para Toggl (`Email`, `Description`, `Start date`,
  etc. — las lee un importador externo, traducirlas rompería la
  compatibilidad); nombres de archivos y carpetas de exportación
  (`task-tracker-exports`, `task-tracker-export_...csv`).
- **No es una fase de producto, es una fase de "congelar textos y
  traducir".** No cambia comportamiento del plugin, solo extrae los
  textos ya escritos en español a archivos de traducción y añade el
  inglés como equivalente.

## Fase 6 — implementación

- **Detección de idioma vía `moment.locale()`, no `localStorage`.** La
  API pública de Obsidian no expone un campo documentado tipo
  `app.locale`/`app.language`. Se descartó `localStorage.getItem("language")`
  (usado por muchos plugins de la comunidad) por ser una clave interna
  no documentada; `moment` sí es un export público de `obsidian`, y
  Obsidian sincroniza su locale global con el idioma de la interfaz.
  Motivo: coherencia con la regla del proyecto de evitar hacks sobre
  el DOM/almacenamiento interno de Obsidian salvo que sea
  estrictamente necesario.
- **Resolución del idioma una sola vez, a nivel de módulo, sin init
  explícito.** `src/i18n/index.ts` calcula el diccionario activo en el
  momento en que el módulo se importa por primera vez, no mediante una
  función `setLocale()` que haya que recordar llamar en `main.ts`.
  Motivo: cambiar el idioma de Obsidian ya exige recargar la app, así
  que no hace falta reaccionar en caliente; un valor calculado una
  sola vez elimina el riesgo de que algún fichero use `t()` antes de
  que el idioma se haya resuelto.
- **`es.ts` tipado como `Record<TranslationKey, string>` contra las
  claves de `en.ts`.** Si falta o sobra una clave en cualquiera de los
  dos diccionarios, el build falla en vez de dejar un hueco de
  traducción silencioso en producción. Motivo: con más de 80 claves
  gestionadas a mano, un typo o un olvido es fácil de cometer y dificil
  de detectar a simple vista; el tipo lo detecta en tiempo de
  compilación.
- **`t(key, params?)` con interpolación simple de `{placeholder}`, sin
  motor de formato ICU ni plurales avanzados.** Solo dos claves de todo
  el glosario tienen partes dinámicas (`recovery.body`,
  `notice.exportSuccess`); el pluralizado sesión/sesiones sigue siendo
  un ternario en `TimeLogView.ts`, no una regla de plural en el
  diccionario. Motivo: no construir infraestructura para una
  necesidad que hoy no existe.
- **Unificación de `log.title` implementada.** `getDisplayText()`
  (título de pestaña) y el `<h4>` interno de `TimeLogView` pasan a leer
  la misma clave (`"Time Tracker"`, igual en ambos idiomas). Esto
  cambia el texto visible del encabezado interno del Historial desde
  el primer día de Fase 6 (antes decía "Historial de tracking"),
  incluso para usuarios en español — cambio de código, no solo de
  contenido, ya decidido y confirmado antes de implementar.
- **Fechas del Historial: sin cambio de código, confirmado.**
  `toLocaleDateString()`/`toLocaleTimeString()`/`toLocaleString()` se
  quedan dependiendo del idioma/región del sistema operativo, no del
  idioma configurado en Obsidian — inconsistencia latente ya conocida
  y aceptada explícitamente, no se fuerza el locale detectado en estas
  llamadas.
- **Barrido completo de `Notice()` antes de implementar.** Se revisó
  `src/` entero (no solo los ficheros con pantallas obvias) buscando
  `new Notice(...)` sin traducir; aparecieron 8 mensajes adicionales
  en `main.ts` y `TimeLogView.ts` que no estaban en el primer borrador
  del glosario (p. ej. los avisos de "tarea ya cerrada" o "nota no
  encontrada"). `src/core/` y `src/export/` confirmados sin texto de
  usuario. Motivo: cerrar el glosario con cobertura real del código,
  no con una lista construida de memoria.
- **`aria-label` de las flechas de navegación del Historial: texto
  dinámico según la vista activa** (`"Día anterior"`/`"Semana
  anterior"`, etc.), no un texto genérico fijo para ambos estados.
  Motivo: un lector de pantalla necesita saber si el botón, en ese
  momento, mueve un día o una semana — un texto ambiguo no lo
  comunica.
- **Verificado manualmente en Obsidian, en ambos sentidos** (español y
  de vuelta a otro idioma, con recarga completa de la app entre
  medias), no solo compilación y tipos.

## Fase 5 — rediseño de interacción del panel Historial

- **Icono de nota delante del título, en vez de un título-link.** El
  título de la tarjeta deja de ser el enlace a la nota de origen; pasa
  a texto plano, y un icono de nota (`file-text`) delante del texto
  asume esa acción, con su propio `stopPropagation()`. Motivo: dejar
  libre el resto de la cabecera para una única acción de
  expandir/colapsar (ver punto siguiente), sin que el título compita
  como zona clicable independiente.
- **Toda la cabecera de la tarjeta (título + línea de meta) expande o
  colapsa las sesiones**, no solo la línea de meta como hasta ahora. El
  chevron pasa a ser decorativo (`aria-hidden="true"`), ya no es el
  único disparador.
- **Icono suelto de borrado en la fila de sesión, revelado por
  `:hover`/`:focus-within`: probado y revertido en la misma ronda de
  trabajo.**
  > ⚠️ **Revertido.** Un icono destructivo apareciendo como reacción
  > pasiva al cursor, sin que el usuario pidiera nada, generaba la
  > sensación de "aquí se borra" incluso diferenciando el hover de la
  > fila (fondo) del hover del propio icono (círculo). Se elimina el
  > icono suelto y su lógica de apertura directa del modal de
  > confirmación; el borrado de una sesión individual vuelve a ser
  > accesible solo desde el botón "Eliminar" dentro del formulario de
  > edición (clic en la fila → editar → Eliminar), igual en desktop y
  > en mobile.
- **Papelera de borrar tarea completa: deja de depender de
  `:hover`/`:focus-within`, se vincula a que la tarjeta esté
  expandida.** Mismo motivo que el punto anterior. Efecto colateral
  positivo: desktop y mobile pasan a compartir el mismo criterio de
  visibilidad — se elimina la distinción `@media (hover: none)` que
  existía entre plataformas para este botón.
- **Área de toque mínima 44×44px en los botones-icono de la cabecera y
  de la fila de sesión**, vía un pseudo-elemento `::after` invisible con
  `inset` negativo, sin inflar el icono visual ni el alto real de la
  fila que los contiene.
- **Formato compacto (`formatDurationCompact()`) para los totales
  agregados** de la cabecera de tarjeta y de la confirmación de borrado
  de tarea, distinto del `HH:MM:SS` que sigue usando cada sesión
  individual. Sin ceros a la izquierda, omite unidades en cero, nunca
  usa "días" (siempre horas, p. ej. `127h 49m`), sin segundos salvo que
  el total sea menor a un minuto. `h`/`m`/`s` se tratan como formato
  universal, sin traducir — mismo criterio ya aplicado a `HH:MM:SS`,
  `→` y `+N` (ver `docs/glosario-traduccion-i18n.md`).
- **Bug corregido — el badge "+N" de cruce de día no calculaba la
  diferencia real de días naturales.** `crossesMidnightRange()`
  (booleano) se sustituye por `getDaySpan(startMs, endMs): number`, que
  calcula la diferencia con `Date.UTC(y, m, d)` (a salvo de cambios de
  horario de verano/invierno) en vez de una resta directa de timestamps
  o de comparar solo las horas. El campo `crossesMidnight` de
  `DraftResolution`, que ya no leía nadie, se elimina junto con el fix.
- **Fecha de fin junto al badge "+N" en filas de sesión.** En sesiones
  que abarcan más de un día natural se añade la fecha de fin entre
  paréntesis justo después del badge (p. ej. `+4 (14/8/2026)`), en tono
  secundario — no el color de énfasis del badge — para no obligar al
  usuario a calcularla a mano en sesiones largas. Aplica a los tres
  sitios que comparten `renderSessionInfo()` (fila estática,
  confirmación de borrado de sesión y de tarea completa); el formulario
  de edición no la muestra, ya tiene su propio campo de fecha de fin
  explícito.
- **Fixes de `cursor: pointer`** en varios elementos activos que no
  mostraban el cursor de mano al pasar por encima: botones de abrir
  nota y papelera, Guardar/Cancelar, Sí eliminar/Cancelar y —
  encontrados durante la misma revisión, no reportados originalmente —
  los botones de navegación de fecha y la papelera propia del
  formulario de edición.

## Fase 5 — ajustes de mobile

- **Icono de play de una tarea abierta sin historial: forzado siempre
  visible en mobile, no solo con `:hover`.** El icono solo se revelaba
  vía `.cm-line:hover`, un estado que no existe en pantallas táctiles —
  quedaba sin ninguna vía visible para iniciar el tracking. Se detecta
  `Platform.isMobile` (API pública de `obsidian`) una sola vez al
  montar el widget (no cambia en caliente) y se fuerza `opacity: 1` vía
  una clase `is-mobile`, sin tocar la regla de hover original (sigue
  rigiendo en desktop).
- **Fecha de apoyo del badge "+N": no se renderiza el nodo en mobile**,
  no solo se oculta por CSS — mismo criterio de `Platform.isMobile` que
  el punto anterior.
- **Metadatos de la cabecera de tarjeta y navegador de fecha, en
  `flex-wrap` en vez de una sola fila fija.** En mobile el panel del
  Historial es más estrecho que la pantalla del dispositivo; sin
  `flex-wrap`, "N sesión(es)" podía partirse por dentro (word-wrap del
  navegador) y el badge de tracking activo se desbordaba fuera del
  borde de la tarjeta. Cada elemento (nº de sesiones, duración, tt-id,
  badge) se trata como bloque atómico (`white-space: nowrap` +
  `flex-shrink: 0`): si no cabe entero, baja entero a la siguiente
  línea, nunca se parte por dentro. El navegador de fecha pasa a dos
  grupos (`Día/Semana/Hoy` y `< fecha >`); con `flex-grow: 1` solo en
  el segundo grupo, este consume todo el espacio libre de la línea
  cuando ambos caben juntos (grupo A queda pegado a la izquierda, grupo
  B centra su contenido en el resto), y cuando no caben y cada uno baja
  a su propia línea, ambos quedan centrados — sin ninguna clase
  condicional ni lógica adicional en JS, solo con las propiedades de
  flexbox ya usadas en el resto del plugin.

## Fase 5 — bug de paneles duplicados (misma nota en 2+ leaves)

- **Bug reproducido — "Task not found" al iniciar tracking por primera
  vez sobre una tarea sin `tt-id` previo, con la misma nota abierta en
  2 o 3 paneles a la vez** (cualquier combinación de modo Edición/
  Lectura), pese a que el dato subyacente (`tt-id`, sesión) era
  correcto. En algunos casos se autocorregía al parar el tracking; en
  otros quedaba fijo hasta reiniciar Obsidian.
- **Diagnosticado con logging temporal (con timestamps) antes de tocar
  código, mismo criterio que el bug de auto-stop** (ver entrada más
  arriba): se instrumentó `InlineTaskControlExtension.handleStart()`
  (justo tras el `dispatch()` que inserta el `[tt-id:: ...]` nuevo),
  `main.ts` (`handleInlineStart()`/`refreshLogViews()`) y
  `TaskIdentifier.ts` (`resolve()`/`searchFiles()`/
  `getLiveEditorContents()`). Los logs confirmaron la causa raíz:
  `getLiveEditorContents()` construía un `Map<filePath, contenido>`
  con un único valor por ruta; si la misma nota está abierta en más de
  un leaf (cada uno con su propia instancia de editor, que no se
  sincroniza con las demás al instante), `Map.set()` sobreescribía en
  silencio el contenido de los leaves anteriores con el del último
  iterado. Si ese último leaf todavía no se había enterado del
  `tt-id::` recién insertado en otro panel, la búsqueda fallaba con
  "no encontrada" aunque el dato ya fuera correcto — y explica también
  por qué el error se autocorregía a veces (una vez los paneles
  convergían) y otras no (si el panel "perdedor" quedaba en segundo
  plano sin refrescarse).
- **Fix: buscar en todos los contenidos en vivo de esa ruta, no en uno
  solo.** `getLiveEditorContents()` pasa a devolver
  `Map<filePath, string[]>` (todos los leaves de esa nota, no solo el
  último en iterarse); `searchFiles()` comprueba cada candidato en
  vivo antes de caer a `cachedRead()`, así que basta con que un solo
  panel tenga ya el `tt-id::` en memoria (p. ej. el que acaba de
  iniciar el tracking) para resolver correctamente, sin depender del
  orden de iteración de los leaves.
- **Criterio explícito al decidir el fix, confirmado con el usuario
  antes de escribirlo: no elegir un "leaf ganador" por heurística**
  (más largo, más reciente, etc.) **sino comprobarlos todos.** Ninguna
  señal fiable de "cuál pane es el más actual" está expuesta por la
  API de Obsidian, así que cualquier heurística de desempate sería
  frágil y arbitraria. Implicación aceptada para el caso — distinto
  del bug reproducido — de ediciones simultáneas realmente
  conflictivas entre paneles (no solo "uno no se ha refrescado
  todavía", sino contenido distinto y no reconciliado entre ellos): la
  búsqueda puede devolver la versión de cualquiera de los paneles que
  contenga el `tt-id`, sin prioridad hacia ninguna en particular. Se
  acepta porque (a) el tracking se indexa por `tt-id` inmutable, no
  por el texto de la línea — el texto resuelto solo se usa para
  mostrarlo (título en el Historial, destino de "abrir nota"), nunca
  decide qué sesión se trackea; (b) esa ambigüedad de "qué pane gana"
  ya existe hoy en Obsidian mismo, fuera del control del plugin (gana
  quien guarde en disco al final); y (c) es la misma clase de
  staleness transitoria que Fase 2 ya acepta explícitamente ("Tarea no
  encontrada" momentáneo), que se autocorrige en el siguiente
  `render()`.
- **Pendiente, sin reproducir de nuevo, no investigado todavía:** se
  observó una vez, sin patrón claro, la creación de una sesión
  "fantasma" de 0 segundos junto a la sesión real al iniciar tracking
  con la nota duplicada en paneles. Anotado para si vuelve a aparecer;
  no forma parte de este fix.

## TaskIdentifier — cold-start "Task not found" (empty editor buffer)

- **Same bug family as "paneles duplicados" above, different trigger:**
  right after Obsidian starts, a `MarkdownView` can exist with its `file`
  already assigned but its editor not yet loaded with real content (an
  empty buffer for an instant). `searchFiles()` in `TaskIdentifier.ts`
  must not treat that empty live-editor candidate as proof the `tt-id`
  isn't on that note — otherwise a task tracked today, checked right at
  startup, would wrongly resolve as "Task not found" even though the
  underlying data was correct.
- **Fix already in place:** `searchFiles()` always falls through to
  `vault.cachedRead()` when no live editor candidate matches, regardless
  of whether the file appears open — absence in a live buffer is never
  treated as absence in the note.

## Fase 5 — icono de nota en tarjetas "Task not found"

- **Bug de alineación — el icono de nota delante del título desaparecía
  por completo cuando la tarea estaba en estado "Task not found"** (sin
  ninguna línea resuelta en el vault para ese `tt-id`), dejando un hueco
  vacío en `noteCol` que rompía la alineación del título entre tarjetas.
- **Fix: icono `file-x` en el mismo hueco, mismas clases que el icono
  normal** (mismo tamaño y posición, solo cambia el glifo — misma
  familia/trazo que `file-text`), en vez de no renderizar nada.
- **Al clic, ya no puede abrir una nota que no existe: muestra el mismo
  aviso (`Notice`) que ya usa `openTaskNote()` cuando la resolución
  falla** (`notice.noteNotFound`, existente, no se duplica el texto),
  para no dejar un control muerto sin ningún feedback. Nueva clave de
  `aria-label` (`log.noteNotFoundAriaLabel`), siguiendo el mismo patrón
  que `log.openNoteAriaLabel`.
- **Sin cambios en el resto del comportamiento de "Task not found"**
  (snapshot del texto de la tarea, sesiones asociadas, título en rojo):
  solo se tocó el icono de la cabecera y su interacción al clic.

## Fase 5 — badge play siempre visible en reposo (sin tracking, sin historial)

- **El badge play/stop junto al checkbox, en su estado "tarea abierta,
  sin tracking activo, sin historial" (equivalente a "sin `tt-id`
  todavía"), pasa a ser siempre visible en vez de revelarse solo con
  `:hover` de la línea** (o vía la clase `.is-mobile` en pantallas
  táctiles, que hasta ahora era la única vía de verlo en mobile). Es el
  único estado que dependía de eso — el resto (`has-history`,
  `is-active`, `is-static`) ya forzaban `opacity: 1` por su cuenta.
- **Estilo en reposo: el mismo tinte apagado que `.is-static`**
  (`color: var(--text-faint)`, fondo transparente, borde
  `--background-modifier-border`), sin heredar su `cursor: default` —
  este botón sí hace algo al pulsarlo (inicia tracking), a diferencia
  del de una tarea cerrada, que no tiene ninguna acción asociada.
- **Bug encontrado y corregido en la misma ronda: la nueva regla en
  reposo pisaba el hover ya existente.** El selector nuevo
  (`:not(.is-active):not(.has-history):not(.is-static)`, 4 clases) es
  más específico que el hover genérico ya existente
  (`:hover:not(.is-static)`, 3 clases) y ganaba incluso durante el
  hover, dejando fondo/borde sin iluminar aunque el icono sí cambiara
  de color (ese sí tenía su propia regla de hover dedicada). Fix:
  duplicar los mismos valores de fondo/borde del hover genérico dentro
  de una regla de hover propia de este estado, en vez de depender de
  que la regla compartida ganara por especificidad.
- **Sin cambios en `InlineTaskControl.ts`/`InlineTaskControlExtension.ts`:**
  el cambio es puramente CSS. Las reglas `.cm-line:hover` y
  `.is-mobile { opacity: 1 }` quedan redundantes para este estado
  concreto (ya es `opacity: 1` siempre) pero no producen ningún efecto
  visual distinto ni en desktop ni en mobile, así que se dejan
  intactas.

## Fase 5 — bug: clic en el hueco invisible del boton de borrar tarea

- **Bug reproducido — con la tarjeta colapsada, un clic en la zona
  donde aparecería el botón de borrar tarea (una vez expandida) abría
  la confirmación de borrado igualmente, sin ningún indicio visual.**
  Causa: `.task-time-tracker-log-card-delete` solo se ocultaba con
  `opacity: 0` en reposo (revelándose con `opacity: 1` al expandir, ver
  entrada de "rediseño de interacción" más arriba) — `opacity` no
  desactiva la interactividad, así que el botón (y su hit-area
  ampliada de 44×44px vía `.task-time-tracker-icon-btn::after`) seguía
  totalmente clicable aunque invisible, interceptando el clic antes de
  que llegara al `header` (cuyo `click` es el que debe togglear
  expandir/colapsar).
- **Fix: `pointer-events: none` en reposo, `pointer-events: auto` al
  expandir** — mismo patrón espejo que ya usa `opacity` en las mismas
  dos reglas. Checked with simulated clicks (Playwright), most likely
  on a static page outside Obsidian (the plugin's CSS with a copy of the
  card markup), not in Obsidian itself: no setup was kept and nothing
  records that Obsidian was driven. Result in both states: collapsed, a
  click on that spot now lands on the `header` (toggle); expanded, it
  still opens the delete confirmation as before. The first check inside
  real Obsidian is H1 (see "Independent client — fixes after desktop
  QA").

## Fase 7 — ajuste "Formato del id de tarea"

- **Nuevo ajuste en Settings, sección general: "Formato del id de
  tarea"** (desplegable Normal/Reducido/Oculto), que controla cómo se
  ve el inline field `tt-id::` cuando **Dataview** lo renderiza
  (Reading mode / Live Preview sin el cursor en la línea). Puramente
  visual — el texto fuente de la nota (`[tt-id:: valor]`) nunca cambia,
  y sin Dataview instalado no tiene ningún efecto (Obsidian no genera
  los atributos `data-dv-key` que el CSS necesita; limitación conocida,
  no se cubre).
- **Implementación: clase en `document.body`, no CSS inyectado en
  caliente.** `applyTaskIdFormatClass()` (`main.ts`) pone/quita
  `task-time-tracker-taskid-reduced`/`task-time-tracker-taskid-hidden`
  en `document.body` según el valor elegido, y el CSS correspondiente
  vive tal cual en `styles.css` (bundled con el plugin, sin generar
  strings de CSS en tiempo de ejecución). **"Normal" no lleva clase ni
  CSS propio del plugin en absoluto** — es literalmente el renderizado
  por defecto de Dataview, sin ninguna intervención; los otros dos
  estados sí acotan sus selectores siempre a `[data-dv-key="tt-id"]`,
  para no afectar a ningún otro inline field que el usuario tenga en
  sus notas.
- **Valor por defecto en instalación nueva: "Reducido", no "Normal"**
  (`DEFAULT_SETTINGS.taskIdFormat` en `types.ts`) — la etiqueta
  completa "tt-id" que renderiza Dataview por defecto es ruido visual
  desde el primer momento para la mayoría de usuarios. Una instalación
  ya existente sin este campo guardado cae en el mismo valor por
  defecto (no hay una migración distinta para "instalación nueva" vs.
  "instalación previa sin el campo": no hay forma de distinguirlas, y
  no se pidió una).
- **Todos los textos nuevos (nombre del ajuste, las tres opciones,
  descripción) van al glosario de i18n existente** (`en.ts`/`es.ts`,
  claves tipadas), sin reabrir Fase 6 — un añadido puntual al mismo
  patrón ya cerrado.
- **Verificado con un harness estático** (estructura real de Dataview:
  `inline-field-key`/`inline-field-value` con `data-dv-key`, más un
  segundo inline field de control sin relación con `tt-id`) que
  confirma los tres estados y que ni ese otro campo ni el badge
  play/stop junto al checkbox cambian de tamaño o posición en ninguno
  de los tres. **No se pudo probar en Obsidian real con Dataview
  activo** (limitación conocida de este entorno, ver notas de fases
  anteriores) — pendiente de confirmación del usuario en su vault.

## Fase 5 — orden ascendente en el panel diario y botón "Hoy"

- **Las tarjetas de tarea y las sesiones dentro de cada tarjeta pasan de
  orden descendente a ascendente** (sesión más antigua del día primero,
  en vez de la más reciente) en `renderDaySection()`. Como
  `groupByTaskId()` preserva el orden de aparición de `entries` para
  decidir el orden de las tarjetas, el cambio de sort ahí basta para
  invertir ambos niveles a la vez, sin tocar `groupByTaskId()` en sí.
  El sort independiente de `renderTaskDeleteConfirm()` (confirmación de
  borrado de tarea completa, con el histórico completo de todas las
  fechas) se deja igual a propósito — descendente — al ser una vista
  distinta, fuera del alcance de "el panel diario".
- **El botón "Hoy" ahora fuerza también la vista diaria**, no solo
  mueve la fecha dentro del modo activo (día o semana). Antes, pulsarlo
  desde la vista semanal dejaba la semana que contiene "hoy" pero sin
  cambiar a vista día — comportamiento inconsistente con lo que el
  nombre del botón sugiere.

## Fase 5 — rediseño de la tarjeta con tracking activo

- **La tarjeta cuya tarea tiene el tracking activo se distingue ahora
  también por su fondo**, no solo por el borde (`border-color:
  var(--interactive-accent)`, ya existente): un tinte muy sutil del
  accent vía `color-mix(in srgb, var(--interactive-accent) 4%,
  var(--background-primary))`, con el valor plano de
  `--background-primary` declarado antes como fallback (mismo patrón
  que el resto del proyecto para navegadores sin `color-mix`).
- **El icono de nota de esa tarjeta pasa a `opacity: 0.5`** (antes
  `opacity: 1`, igual que en cualquier otra tarjeta): con la tarjeta ya
  distinguida por fondo y borde, este icono puede pesar menos sin
  perder legibilidad. Solo se toca `opacity`, nunca color/tamaño — el
  botón sigue siendo el mismo control funcional, con el mismo hover en
  `--text-accent` de siempre.
- **La flecha `→` entre hora de inicio y hora de fin, dentro de esa
  misma tarjeta, pasa a `--text-faint`** en vez de heredar el color de
  las horas que separa (`--text-normal`) — es un separador visual, no
  un dato en sí. Requirió una clase nueva en el span
  (`task-time-tracker-log-session-arrow`, `TimeLogView.ts`), ya que
  antes era texto suelto sin ningún selector propio.
- Estas tres reglas quedan acotadas a `.task-time-tracker-log-row.is-tracking-active`
  — no afectan a ninguna otra tarjeta del panel.

## Fase 5 — total de la vista y rediseño del navegador de fecha

- **Nuevo total de tiempo junto al título del panel** ("Time tracker"),
  alineado a la derecha: icono de reloj + duración en formato HH:MM:SS
  (`formatDuration`, no el formato compacto de las tarjetas) del rango
  actualmente visible (día o semana). Si la tarea activa cae dentro de
  ese rango, el número tickea en vivo por segundo, reutilizando el
  mismo mecanismo (`activeCardTicks` + bus) que ya usan las tarjetas —
  sin un `setInterval` propio.
- **El toggle Día/Semana pasa a ser un único control segmentado** (un
  borde y un fondo compartidos, `overflow: hidden` para recortar las
  esquinas de los botones internos) en vez de dos botones sueltos con
  su propio borde cada uno.
- **El botón "Hoy" se separa del toggle** y pasa a alinearse al extremo
  derecho de la barra de navegación (antes vivía pegado al toggle, a la
  izquierda). El navegador de fecha (flechas + fecha) queda en medio.
- **Formato de fecha más corto en vista día:** "Mié, 12 ago 2026" en
  vez de "miércoles, 12 de agosto de 2026" — ya no necesita competir en
  ancho con el toggle y "Hoy" en la misma línea. `Intl` devuelve el
  nombre de día/mes en minúscula en locale `es`; solo la primera letra
  se pasa a mayúscula a mano en JS (`label.charAt(0).toUpperCase() +
  label.slice(1)`), no toda la cadena — `text-transform: capitalize`
  también habría afectado a "ago".
- **Layout responsive: toggle + fecha + "Hoy" en una sola línea en
  ventanas anchas (rango centrado entre los otros dos, único elemento
  con `flex-grow`), y toggle + "Hoy" agrupados en una línea con la
  fecha debajo en ventanas estrechas.** No hay combinación de
  `flex-wrap` puro que agrupe "primero y tercero sin tocar el segundo"
  cuando el segundo es el único con crecimiento — a diferencia del
  ajuste de mobile anterior (Historial, tarjetas), aquí sí hizo falta
  una **`@container` query** (`container-type: inline-size` en
  `.task-time-tracker-log-datenav`) que reordena los tres bloques vía
  `order` según el ancho del propio contenedor, no del viewport.
- **Bug encontrado y corregido en la misma ronda: el punto de corte de
  la query (420px, estimado a ojo) se quedaba corto una vez el rango de
  fecha reservó `min-width: 21ch`** (ver bullet siguiente) — el orden
  se reseteaba a "una sola línea" antes de que el contenido cupiera de
  verdad, y el resultado era una agrupación rota: toggle + rango
  compartiendo la primera línea, "Hoy" solo en la segunda. Fix en dos
  partes: (a) se subió el punto de corte a 480px, con margen sobre el
  ancho real medido (~465px con un harness estático fuera de Obsidian,
  iconos/fuente aproximados) por si el tema o idioma real del usuario
  usa botones o iconos algo más anchos; (b) `flex-basis: 100%` en el
  rango de fecha por defecto (antes solo `flex: 1 1 auto`, con `basis`
  implícito en `auto`), para que ocupe siempre su propia línea completa
  por debajo del punto de corte, sin importar si el contenido cabría
  "por accidente" en una sola línea a un ancho menor — sin esto, quedaba
  una franja donde "Hoy" aparecía pegado al toggle en vez de al extremo
  derecho. Verificado con un harness estático variando el ancho del
  panel de 200 a 600px, en vista día y semana.
- **`min-width: 21ch` en la etiqueta de fecha** (petición del usuario,
  verificado empíricamente por él en su propio Obsidian): sin esto, el
  texto de la vista semana ("8/10/2026 – 8/16/2026") es más ancho que
  el de la vista día ("Mié, 12 ago 2026"), así que alternar entre
  ambas cambiaba el ancho de esa fila con el panel en el mismo ancho —
  pudiendo cruzar por su cuenta el punto de corte de la `@container`
  query y hacer saltar de línea el navegador de fecha solo por
  cambiar de modo, no por cambiar el ancho del panel.

## Fase 5 — tipografía monoespaciada en todas las sesiones

- **Fecha, rango horario (hora inicio → hora fin), fecha de fin de
  apoyo junto al badge "+N" y duración total: todas en
  `var(--font-monospace)` en cualquier tarjeta**, no solo en la que
  tiene tracking activo. La regla vive en el contenedor común
  (`.task-time-tracker-log-session-info`), del que las cuatro heredan
  por posición en el DOM, en vez de una declaración por clase. Se
  retira la regla scoped a `.is-tracking-active` que aplicaba esto
  antes solo ahí (quedaba redundante una vez generalizada) — la regla
  de la flecha muted (ver entrada anterior) sí se mantiene scoped, al
  ser un ajuste de color deliberadamente distinto solo para esa
  tarjeta, no de tipografía.

## Fase 5 — rediseño visual del Historial (cabecera + lista)

Adopta el pulido visual de un prototipo de Claude Design
(`Time Tracker Tab.dc.html`, actualizado varias veces durante la ronda)
para la cabecera del panel y la lista de tareas, en las tres vistas
(Día, Semana, Resultados). Varias rondas de QA visual, cada una
corrigiendo algo que la anterior no había resuelto del todo — se deja
constancia de las que dejaron una lección reutilizable, no solo del
resultado final.

- **Cabecera reducida a una sola fila**, no tres: toggle Día/Semana +
  Hoy + flechas/fecha + iconos de calendario y filtro, todo junto
  (`margin-left: auto` en el grupo de iconos), con `border-bottom`
  como separador. Sustituye el diseño de fila superior + fila inferior
  de una iteración anterior (ver "Fase 5 — total de la vista y
  rediseño del navegador de fecha" arriba) — esa nota describía tres
  filas por error de interpretación del prototipo real, que siempre
  usó una.
- **Subtítulo bajo "Time Tracker"**: "N tareas · M sesiones" en Día,
  "N tareas · M días con actividad" en Semana/Resultados — nunca "N
  tareas · 1 día con actividad" en Día (dato trivial en un solo día).
  Etiqueta "Total del rango" añadida sobre el total de la esquina
  (mismo dato de siempre, solo se le pone rótulo).
- **Icono de reloj/cronómetro junto a un total: solo si ESE total
  tiene la sesión activa** (cabecera, tarjeta o cabecera de día),
  nunca fijo — indicador de "esto suma en vivo", no decoración. El
  prototipo no lleva icono en absoluto; se decidió mantenerlo pero
  condicionado, porque aporta información real que una maqueta
  estática no necesitaba representar.
- **Agrupación por día: un único contenedor (borde/radio/fondo
  compartidos) por día, con `border-top` como divisor entre tareas**
  (`:not(:first-child)`, selector puramente posicional), en vez de
  tarjetas sueltas con hueco entre sí. El primer intento de esta ronda
  lo planteó como "solo CSS sobre las clases existentes" y no tocó el
  markup — bastaba, porque `renderTaskList()` ya creaba un contenedor
  por día; el border/radio/fondo solo tenían que moverse de la fila a
  ese contenedor.
- **Bug de QA real, no solo de valores**: tras el rediseño anterior,
  varias rondas de ajustes de tipografía/espaciado no convergían
  porque el problema no era de valores CSS sueltos — la jerarquía del
  DOM de la tarjeta no coincidía con la del diseño. El diseño real
  agrupa icono+título+proyecto/cliente en un bloque propio
  (`flex: 1 1 auto`, columna), del que la columna de duración+sesiones
  y el kebab son hermanos — no hijos sueltos de la misma fila que el
  icono y el título. Sin esa jerarquía, ningún `align-items` conseguía
  alinear la columna derecha contra el bloque completo (título+meta),
  solo contra la primera línea. Lección: ante varias rondas de QA
  visual sin converger, comparar el HTML real generado contra el HTML
  de referencia elemento por elemento antes de seguir ajustando CSS.
- **Título de tarea: hasta 2 líneas antes de truncar**, vía
  `display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient:
  vertical;` (soportado en Chromium/Electron, base de Obsidian) — no
  una altura fija ni un segundo `<span>` de línea siempre presente.
  `applyTruncationTooltip()` tuvo que aprender a comparar también
  `scrollHeight`/`clientHeight`, no solo `scrollWidth`/`clientWidth`:
  el recorte por `line-clamp` trunca por alto, no por ancho.
- **Todos los iconos de la tarjeta necesitan tamaño explícito en el
  `<svg>`** (14px tarea, 11px proyecto/cliente, 15px kebab) — sin él,
  Lucide/Obsidian renderiza a su tamaño por defecto (~24px),
  desbordando visualmente el resto de la fila.
- **El botón de nota necesitó, además, una caja fija (14×16px,
  `padding: 0`)**, no solo el `<svg>` a tamaño explícito: sin caja
  propia, el `<button>` nativo de Obsidian (`clickable-icon`) conserva
  su padding por defecto y el botón acaba más alto que una sola línea
  de texto — estirando toda la fila y dando la falsa impresión de que
  el título reservaba espacio para una segunda línea que no usaba
  (bug que en un principio se diagnosticó, incorrectamente, como un
  problema del `line-clamp`). El botón kebab nunca sufrió esto porque
  ya tenía una caja fija (28×28) desde antes; con `box-sizing:
  border-box` (el que usa Obsidian globalmente), una caja explícita
  absorbe el padding nativo en vez de sumarse a él.
- **`align-items: center` en el propio botón de nota anulaba el
  `margin-top: 2px` del icono**: aunque la fila exterior
  (`.task-time-tracker-log-card-title-line`) ya usaba
  `align-items: flex-start` para pegar el icono a la primera línea del
  título, el botón en sí era OTRO contenedor flex con
  `align-items: center`, que recentraba el `<svg>` dentro de su propia
  caja (más alta que el icono) y anulaba el margen. Fix: `flex-start`
  también en el botón, no solo en la fila que lo contiene.
- **Sin chevron**: la fila entera ya expande/colapsa al clic (revert
  parcial deliberado de la decisión de Fase 5 "ningún control depende
  solo del hover" — el gesto de clic ya existía, el hover en
  escritorio es un añadido visual sobre el mismo gesto, y en móvil el
  tap sigue funcionando igual). Un chevron dedicado quedó redundante y
  competía por espacio con el título.
- **El tt-id deja de pintarse en la tarjeta** (seguía existiendo como
  concepto interno) — no tenía hueco en el diseño de columna derecha
  del prototipo y no aporta nada al usuario final en esa vista.

## Fase 5 — fix responsive de la cabecera del Historial y limpieza del date-picker

- **Container queries (`@container`), no media queries, con solo 2
  formatos.** `.task-time-tracker-log-datenav` pasa a
  `container-type: inline-size`; la fila de controles usa CSS Grid con
  `grid-template-areas` en vez de `flex-wrap`. Formato Ancho (≥400px de
  contenedor: toggle + flechas/fecha + calendario/filtro en una sola
  fila) y Compacto (<400px: toggle+iconos arriba, flechas/fecha debajo).
  400px es el único punto de corte; tablet no tiene tratamiento propio,
  hereda Ancho. Motivo: el ancho real del panel/leaf no se corresponde
  con el viewport (un side panel puede ser estrecho en un monitor
  grande, y viceversa), a diferencia de los ajustes de mobile anteriores
  de esta fase.
- **El botón "Hoy" se elimina de la cabecera del Historial.** Quedaba
  redundante con el que ya existe en el pie del date-picker (mismo
  destino, `goToToday()`); el único punto de entrada a "Hoy" pasa a ser
  abrir el calendario y pulsar "Hoy" en su pie. Calendario y filtro de
  proyecto se agrupan en un único bloque atómico (nunca se separan entre
  sí), siempre anclado al borde derecho de la fila en ambos formatos.
- **Bug real de CSS Grid encontrado y corregido: una columna `1fr` no se
  encoge por debajo del min-content de su contenido por defecto.** En el
  tramo ~400-550px, con el toggle y el grupo calendario/filtro ya
  ocupando su ancho `auto`, la columna central (`1fr`) no tenía margen
  para bajar por debajo de lo que pedía el grupo flechas+fecha —
  agravado por el `min-width: 21ch` fijo de la etiqueta de fecha (ver
  "Fase 5 — total de la vista y rediseño del navegador de fecha" más
  arriba), que actuaba como un suelo, no como una preferencia. El
  resultado: el grupo desbordaba visualmente su columna y pisaba el
  toggle Día/Semana. Fix en dos partes: `minmax(0, 1fr)` en la columna
  central, y la etiqueta pasa de `min-width: 21ch` a
  `flex: 0 1 21ch; min-width: 0` — mismo ancho preferido cuando hay
  espacio (sin jitter al alternar Día/Semana), pero ahora capaz de
  encogerse de verdad y activar su propio `text-overflow: ellipsis` en
  vez de desbordar. Verificado con un harness estático (HTML+CSS reales
  del componente, sin depender de Obsidian) en todo el rango 260-600px,
  en label de día y de semana.
- **Botón "Limpiar" eliminado del pie del date-picker.** Tras la
  investigación de por qué el usuario reportaba que "Limpiar" y "Hoy"
  "hacían lo mismo": ambos llamaban a `goToToday()` — eran, literalmente,
  dos botones para una sola acción, pese a que `DatePickerPopover.ts`
  documentaba en su cabecera dos rondas previas de QA (v1/v2) intentando
  darle a "Limpiar" un comportamiento propio distinto de "Hoy" antes de
  asentarse en que ambos hicieran lo mismo (v3) — ese historial, ya sin
  utilidad una vez eliminado el botón, se resume y se quita del
  comentario. "Hoy" queda como único punto de salida del filtro de
  fecha. Se elimina también la clave de traducción
  `log.datePickerClear`, sin más usos en el codebase.

## Shared popover anchoring (positionPopover.ts)

- **Extracted from ProjectPickerList.ts into its own module after a bug
  where the date-picker got clipped in a narrow sidebar:**
  `DatePickerPopover.ts` had reimplemented its own anchoring instead of
  reusing ProjectPickerList's, which already solved the same problem in
  production. `positionPopover()` is now the single anchoring
  implementation both popovers share.

## ProjectPickerList — two-line row instead of "name · client"

- **Reverted to a two-line row (name on top, client below) after QA
  with real data:** the original single-line "name · client" format
  made the whole project disappear for long client names, and
  truncated both fields even in the normal case. Each line now
  truncates independently (see CSS), so the project name shows in
  full or truncated regardless of how long the client name is, and
  vice versa.

## sessionEdit.ts — silent Date overflow on invalid day (critical, 0.0.29)

- **Critical bug: an out-of-range day (e.g. "2026-08-88", or
  "2026-02-29" in a non-leap year) in the session edit form's date
  field was saved as a different date with no warning.** The `Date`
  constructor alone doesn't reject an invalid day, it silently
  overflows into following months/years (`new Date(2026, 7, 88)` gives
  October). Fix: `parseDateInput()` rebuilds the date from its
  components and compares it against what was typed — if `Date`
  reinterpreted it, the mismatch is caught and the input is rejected
  instead of silently saving the wrong day.

## DatePickerPopover — two reopening/re-render bugs

- **`selectedRangeEnd` added to `DatePickerPopoverOptions`:** reopening
  the picker with a week or a results range already applied only
  marked `selectedDate` as a lone day, losing the rest of the range in
  the grid even though the filter was still active. The option is
  optional — omitting it keeps the old lone-day behavior for Day/Week
  when the caller has no range to preserve.
- **`reanchorDatePickerPopover()` added:** TimeLogView rebuilds its
  whole navigation bar from scratch on every render, including the
  calendar button. Without reanchoring the open popover to the fresh
  button, a second click on the new button read simultaneously as
  "outside" (the old button's listener closed it) and "open" (the new
  button's own handler), so the picker never seemed to actually close.
  The caller now calls `reanchorDatePickerPopover()` after every render
  with the fresh button reference.

## Seguridad frente a sync multi-dispositivo (leer-antes-de-escribir)

- **El estado en memoria deja de ser la fuente de verdad al escribir.**
  Hasta ahora el plugin cargaba `data.json` una sola vez en `onload()` y
  cada operación guardaba el blob `PluginState` entero desde memoria. Con
  Obsidian Sync y dos dispositivos activos eso perdía datos: A crea
  sesiones → Sync deja el `data.json` nuevo en el disco de B → B, con su
  copia vieja en RAM, toca cualquier cosa (start/stop, editar, borrar, un
  ajuste, renombrar un proyecto) y reescribe el archivo entero desde
  memoria obsoleta, borrando lo de A. La decisión: toda operación que
  cambie estado **relee `data.json` justo antes de mutar**, aplica
  únicamente su propia mutación sobre ese estado recién leído, guarda, y
  solo entonces adopta el resultado persistido como estado en memoria.
  Una operación sobre un registro nunca puede borrar registros ajenos que
  existan en disco pero no en memoria. Vive en `core/StateStore.ts`
  (`apply()` es la primitiva; `normalizeState()` el único punto de
  conversión de lo que devuelva `loadData()` a un `PluginState` válido).
- **No se fusionan snapshots completos.** Descartada la alternativa de
  unir por id los dos estados (memoria + disco) después del hecho:
  resucitaría registros borrados en otro dispositivo, ya que un registro
  ausente en memoria puede significar "borrado" o "todavía no lo he
  visto", y un snapshot no distingue los dos casos. Es la operación
  concreta la que decide qué cambia.
- **El formato de `data.json` no cambia.** Ni migración, ni campos de
  metadatos nuevos, ni archivos por sesión: los usuarios existentes
  actualizan sin hacer nada, y el histórico, la exportación, el Dashboard
  y la recuperación de sesión activa siguen igual.
- **Nada captura el objeto de estado.** Como el store lo reemplaza entero
  tras cada escritura, `main.ts` expone `pluginState` como getter, y
  `TrackingEngine`, `ProjectManager`, `SettingsTab` y `EditTaskModal`
  leen a través de accesores en cada uso en vez de guardar una
  referencia. Los paneles (`TimeLogView`, `DashboardView`), la status bar
  y el control inline ya leían así, no necesitaron cambios.
- **`onExternalSettingsChange()` refresca, nunca guarda.** Es el aviso de
  Obsidian de que `data.json` cambió por fuera (Sync entregando lo de
  otro equipo, o una edición manual). Solo relee y refresca UI: observar
  un cambio externo no justifica una escritura, y una relectura no puede
  crear ni detener un timer — el timer activo sigue siendo, como siempre,
  la sesión con `end === null` que diga el disco.
- **Sesiones abiertas simultáneas: se cierran, nunca se descartan.** Si
  el disco trae más de una sesión con `end === null` (tracking arrancado
  en otro dispositivo), `start()` las cierra todas antes de abrir la
  nueva y avisa por consola; `stop()` cierra solo la que el usuario está
  viendo y deja las demás intactas, avisando también. Si la sesión activa
  en memoria ya no está en disco, se reconstruye cerrada en vez de perder
  la operación. En ningún caso se borra un registro ni se inventa
  historial.
- **Carrera que sigue sin resolver, aceptada a propósito.** A lee el
  estado viejo, B lee el estado viejo, A escribe lo suyo, B escribe lo
  suyo antes de que Sync le haya entregado el cambio de A. Leer antes de
  escribir no puede fusionar datos que todavía no han llegado a la
  máquina; resolver eso exigiría un formato con historial por registro (o
  un archivo por sesión), fuera del alcance. Lo que sí queda garantizado:
  en cuanto una versión sincronizada está en el disco local, ninguna
  operación local posterior pisa los registros ajenos de esa versión.
- **Primeras pruebas automatizadas del proyecto.** `tests/` +
  `npm test`, con el runner nativo de Node (`node --test`) sobre las
  pruebas compiladas por el esbuild que el proyecto ya usa
  (`esbuild.test.mjs`). Sin ninguna dependencia de desarrollo nueva, y
  funciona igual en las tres versiones de Node del CI (20, 22 y 24), que
  no comparten soporte nativo de TypeScript. El "disco" simulado hace un
  ida y vuelta por JSON en cada `load`/`save`, así que memoria y disco
  nunca comparten referencias y una prueba no puede pasar por accidente.

## Historial header — v2 redesign (full-width stepper)

- **Replaces the earlier 400px container-query header redesign** (see
  the "Fase 5 — fix responsive de la cabecera del Historial" entry
  above) after several rounds of patches on that approach, using specs
  and prototypes the user provided ("Cabecera Time Tracker.dc.html" and
  "Header Responsive Wireframes.dc.html", the "1c — full-width
  stepper" strategy).
- **Single 480px container breakpoint, shared by all three view modes
  (Day/Week/Resultados).** Wide format (>=480px): a single-row
  "auto 1fr auto" grid — toggle/Volver on the left, arrows+date (or the
  Resultados range box) in the center, calendar+Filter anchored right.
  Compact format (<480px): two rows — toggle/Volver + calendar+Filter
  on row 1, a full-width framed control on row 2 (a real stepper in
  Day/Week, a non-interactive centered box in Resultados).
- **The "Hoy" button is removed from this bar entirely, in every
  format.** The date-picker's footer (see
  DatePickerPopover.ts#goToToday) becomes the single entry point to
  "today", replacing the standalone button the previous header
  redesign had added.
- **Resultados range gets its own framed box** (border + background,
  `.task-time-tracker-log-results-rangebox`) instead of plain text, to
  match "Volver" and calendar+Filter, which are also framed controls.

## Historial — retomar tracking de una tarea ya registrada

- **Nuevo control en la tarjeta del Historial para retomar el tracking de
  una tarea ya cerrada (con historial), sin volver a la nota.** Vive en
  una franja (`.task-time-tracker-log-card-control-slot`) colapsada a
  ancho 0 en reposo, entre el título y la columna de duración/sesiones —
  nunca después de esta última. Se revela con `:hover` o `:focus-within`
  de toda la fila (no solo del propio botón, para que un usuario de
  teclado que tabula hasta un botón de ancho 0 pueda verlo aparecer) o
  siempre en dispositivos táctiles, donde `hover` no existe. La fila con
  tracking activo nunca colapsa su control, al haber como máximo un timer
  activo a la vez (regla no negociable del plugin).
- **El título de la tarjeta vuelve a truncarse en una sola línea,
  revirtiendo el clamp a 2 líneas** adoptado en el rediseño visual
  anterior (ver "Fase 5 — rediseño visual del Historial (cabecera +
  lista)"). Motivo: la nueva franja de acción anima su ancho entre 0 y
  28px al hacer hover/focus sobre la fila, y un título que aún pudiera
  envolver a una segunda línea se re-envolvería a mitad de esa
  transición, causando parpadeo visual y pudiendo empujar la columna
  derecha. El truncado en una sola línea evita el problema de raíz: la
  altura del título ya no depende de cuánto ancho tenga en cada
  instante, así que la transición de 150ms solo mueve el punto de corte
  del ellipsis, nunca el layout de la fila.

## Task search — Block 1: Resultados in descending order

- **Resultados lists days newest first.** The first 180-day page now
  starts at the range's most recent day, and "Load more" walks further
  back in time. Before, it started at the oldest day and paged forward,
  which made no sense for a long history. Card order within a day is
  unchanged (Fase 5 decision). The range total was already full-range,
  independent of pagination, so it didn't change either.

## Task search — Block 2: header chips and search slot

- **Filter chips are the single place that shows a filter's value.** One
  chip per active filter, each with its own "×", in a row under the
  header in every view (Day, Week, Resultados). The header icons
  (calendar, search, filter) only say "a filter is active" via the
  shared `is-active` tint. Only the project filter exists for now. The
  text and date filters will add chips through the same
  `renderFilterChips` list.
- **The filter button is icon-only in every state.** The project-name
  label inside it, its 609px/574px breakpoints, and the separate inline
  "×" next to it are all removed. The chip replaces all three.
  `.task-time-tracker-log-filter-btn(-label)` survives only because the
  Edit modal's Project button still uses it.
- **Resultados header: "← Volver | N tareas encontradas".** The range
  box ("1–15 sep · 15 días") is replaced, not kept alongside, by a task
  counter. A divider sits between Volver and the counter so the pair
  reads as action + state, not as one "go to Results" link. The counter
  uses the same full-range, project-filtered task count as the
  subtitle. The selected range is no longer shown as text in this
  block. It comes back as a date chip in Block 4.
- **Volver returns to where Resultados was entered from** (the same Day
  or Week position), not always to Day/today. Picking a new range while
  already in Resultados keeps the original return point. The point is
  captured when the date-picker opens, not when the range completes: the
  picker applies every click immediately, so a range's first click has
  already moved the view to that day (first build returned to the range
  start because of this).
- **Resultados never exists without a filter.** When the last filter
  is removed, the view closes back to that return point
  (`closeResultsIfNoFilters`). The date range counts as a filter, and
  today the date-picker is the only way into Resultados, so this rule
  can't trigger until an entry point without a range exists.
- **The search slot (placeholder, no search logic yet).** The search icon
  toggles a field in the header's "mode" slot. The field replaces the
  Day/Week toggle, or Resultados' back+counter block, directly with no
  transition. It never touches `viewMode`/`anchorDate`, so closing it
  restores the toggle in the same Day/Week state.

## Task search — Block 3: suggestions and search logic

- **What's compared: each session's stored `taskText`, plus the tt-id.**
  The stored text is the line without its checkbox or tt-id. Search is
  in memory, with no vault reads, so tasks whose note was deleted are
  still found. A renamed task is still found by its old name (accepted).
  Matching ignores case and accents (NFD + strip diacritics). The pure
  logic lives in `core/TaskSearch.ts`, covered by `tests/TaskSearch.test.ts`.
- **Matching is per task, not per session.** If any session of a task
  matches, every session of that task is shown, so searching an old name
  brings the whole renamed task.
- **Two ways to confirm.** Picking a suggestion filters by that task's
  tt-id (`SearchFilter.taskId`). The chip shows its text, but other tasks
  whose text merely contains it never slip in. Enter with no suggestion
  highlighted searches the typed text as a substring. Nothing is
  highlighted until the arrow keys are used, so plain Enter always means
  "this text as-is".
- **The search icon's active tint means "a search is confirmed"** (its
  chip is visible), whether or not the field is open. It does not mean
  "the field is open". This is the same criterion as calendar and
  Filter: active = a filter of this kind is applied. Block 2 tinted it
  while the field was open, a placeholder from before searches could be
  confirmed.
- **Suggestions show the tt-id** on the right, in the same raw form as
  the Edit task modal, so an id pasted from there visibly matches.
- **Search only exists inside Resultados.** Confirming enters it, taking
  the Day/Week position as the return point. Every way out of Resultados
  (`leaveResults`) clears the search together with the date range.
  Resultados can now exist with no date range (whole history). Its
  pagination then spans the first to the last matching day.
- **AND everywhere:** text AND project AND an existing date range. A range
  applied from Resultados is kept when a search is confirmed. Suggestions
  are drawn from that same scope, so a suggestion never leads to an
  empty Resultados.
- **Date-picker in a search:** with a search active, every picker
  selection (a lone day, a week, a range, or the footer's "Today") only
  scopes the search in time. It stays in Resultados with that day/week
  as the range, keeping the search and the project filter. Only the
  search chip or "Volver" drops a search, never the calendar. The first
  build left Resultados on a day/week and silently lost the search. This
  also covers a range's first click, which is applied as a lone day,
  so the earlier snapshot-and-restore workaround is gone. Without a
  search, a day/week still leaves Resultados as before. Block 4 owns the
  rest of the calendar-within-search design (the date chip).
- **The empty state's "Quitar filtros"** now returns to the return
  point, like Volver, instead of Day/today. The no-match message is a
  basic placeholder. Block 5 owns the final copy.

## Task search — Block 3 close: "Retomar" stores the note's current text; card title aligned with the note icon

- **Background: stored text is never resynced.** `TimeEntry.taskText` is
  written only when a session is created (`TrackingEngine.start`). No
  path rewrites it afterwards, including renaming or moving the note,
  stopping, or editing times. Cards look "resynced" because, while the
  note exists, their title shows the note's live line, resolved by
  tt-id. `taskText` is only the fallback for a deleted note. Search reads
  only `taskText`, so a rename was invisible to it until a new session
  stored the new name.
- **"Retomar" now stores the note's current text and location** when the
  task's line is still in the vault (`resolvePreferring(taskId,
  latestSession.filePath)` + `parseCheckboxLine`). Before, it copied the
  previous session's snapshot, so resuming from the panel kept saving
  the old name forever. If the line can't be found, or is no longer a
  checkbox, it falls back to the previous snapshot as before. It reads
  the note but never writes it. `filePath` is taken from the same
  resolution, so the new session points at the note the text came from.
- **`resolve()` vs `resolvePreferring()` with a duplicated tt-id.** For
  example, a note duplicated as a backup leaves the same `[tt-id:: …]`
  in two files.
  - `resolve()` returns the first matching line while iterating
    `vault.getMarkdownFiles()`. The public API doesn't document that
    order, so which copy wins is undefined. All copies count as one
    task, so the time adds up correctly either way.
  - `resolvePreferring(taskId, path)` looks in `path` first and falls
    back to `resolve()` if that note no longer has the tt-id.
- **Mismatch fixed: card title vs note icon.** The title, its
  closed-task state, and "not found" used `resolve()`, while the note
  icon used `resolvePreferring()`. With a duplicated tt-id, a card could
  show copy A's text and open copy B. Both now use
  `resolvePreferring()` with the same preferred path: the note of the
  task's latest session across the whole history (`latestSessionPaths`).
  Before, the icon used the latest session among the card's own
  sessions, which on a day or week card is not necessarily the task's
  latest. Title and icon now always point at the same note.
- **Unchanged, still on `resolve()`:** the Dashboard, the CSV export's
  task text, and repositioning the tt-id when tracking stops.
- **Backlog, no date:** making `resolve()`'s fallback deterministic, for
  example first match in alphabetical path order. It would change the
  Dashboard, the export and the tt-id repositioning too, so it's a
  separate decision. The README documents the duplicated-notes case as
  undefined behaviour ("avoid duplicating notes that contain tracked
  tasks").

## Task search — Block 4: calendar within a search + date chip

- **Already in place from Block 3, verified rather than rebuilt:**
  - With a search active, a day, week or range from the calendar stays
    in Resultados and only scopes the search in time.
  - The calendar icon is tinted whenever Resultados has a date range.
  - Suggestions are drawn from text AND project AND that range, because
    they use the same bounds as Resultados.
  - The close rule already counts the range as a filter.
- **The date chip appears in any Resultados with a date range**, not only
  inside a search. Block 2 dropped the range box on the understanding
  that the date would come back as a chip. Removing the text chip
  leaves a range-only Resultados, and it would be inconsistent for the
  range's chip to disappear while the range stays applied. Day/Week
  navigation never shows a date chip: it is navigation, not a filter.
- **The chip's "×" removes only the range.** Resultados widens to the
  whole history, keeping search and project. With no other filter left
  (a range picked straight from the calendar), the Block 2 close rule
  returns to the entry point.
- **Chip order: project, text, date**, matching the mockup. Block 3 had
  text before project.
- **Format: `Intl.DateTimeFormat.formatRange`** (day + short month), not
  two dates joined by hand. Each locale orders the parts and merges the
  shared ones itself ("1–15 sept" / "Sep 1 – 15"). The old range box's
  hand-built format read "1 - Sep 15" in English. A lone day shows
  as one date. The year is shown only when the range isn't entirely in
  the current year.

## Resultados pagination: by number of cards, not a fixed day window

- **Replaces Block 1's 180-day window.** A fixed window anchored at the
  newest end could hold no match at all, for example a search over the
  whole history whose only hit is months old, or a sparse range. The
  first page then showed only "Load more", with no hint of whether
  anything existed further back.
- **Page = whole days, newest first, until at least `RESULTS_PAGE_CARDS`
  (30) cards per loaded page.** A card is one task on one day, the unit
  `renderTaskList` draws. It is not one session: several sessions of the
  same task on a day share a card. A day is never split; if it crosses
  the threshold, all of it is shown and the page runs over. Only days
  with matches are walked, so empty days cost nothing. "Load more"
  raises the target by another 30 and recomputes from the newest day, so
  no day is repeated or skipped. It only appears while matching days
  remain.
- **Why 30:** every loaded card's task is resolved against the vault on
  each render, and "Load more" re-renders all loaded pages. A deleted
  note means a full vault scan for that task. 30 cards fill two or three
  screens of the side panel, so a page never looks thin, while keeping
  that cost bounded.
- **Unchanged from Block 1:** newest-first order, backward paging, card
  order within a day, the full-range total, and the empty state. The
  button text stays "Load more" / "Cargar más". The "(180 días)" from
  the mockup was never in the code, so there was no count to replace.

## Task search — Block 4b: "View full history" row for a filtered project

- **A third way into Resultados, needing neither a date nor a search.**
  In Day/Week with a project (or "No project") filtered, a row under
  the chips shows the funnel and the project name on the left and
  "View full history →" on the right. Pressing it enters Resultados with
  only the project filter: no date range (the Block 3 whole-history
  Resultados), no search. The return point is the current Day/Week
  position. An open, unconfirmed search field is discarded, as when it
  is closed by hand.
- **Never shown inside Resultados**, whatever brought you there, and gone
  as soon as the project filter is removed. It is rendered from the
  filter state on every render, so it has no state of its own to go
  stale.
- **The project popover is untouched.** It still just filters the
  current day/week. The row is a separate element.
- **First real trigger of the Block 2 close rule without a search:** in
  that Resultados, removing the project chip with no text or date added
  returns to the entry point.
- **The arrow is a Lucide icon**, not a "→" in the translated string, so
  screen readers don't announce "right arrow". The project name is the
  only part that truncates; the action never wraps.
- **Amendment after QA: chips are Resultados-only; the row replaces the
  project chip in Day/Week.** With both, the project showed twice, as a
  chip and right below it in the row. This overrides Block 2's "chips in
  every view". In Day/Week the project is the only possible filter, so
  the row is its only representation and carries that chip's "×". That
  "×" has to exist somewhere: the project popover has no "clear" option,
  and the inline "×" next to the funnel was removed in Block 2.
- **Look, per the design sketch:** the same accent tint and border as
  the active header icons. The funnel is in accent, the project name in
  bold, and "View full history →" is accent text with no button frame.
- **Obsidian's `button:not(.clickable-icon)` was overriding plain-class
  button styles.** The chip "×" rendered as a filled circle, and the row
  action as a framed button. The "×" buttons now carry `.clickable-icon`,
  Obsidian's own opt-out also used by the panel's other icon buttons. The
  row action, a text button, uses a two-class selector instead.

## Task search — fix after QA: suggestions ignore the project filter

- **Suggestions come from the whole history regardless of the project
  filter.** They are still scoped to Resultados' date range, if any.
  Before, they were cut down to the filtered project with no visible
  hint, so tasks from other projects looked like they didn't exist.
  This reverses Block 3's "a suggestion never leads to an empty
  Resultados".
- **Picking a suggestion never touches the project chip.** The user
  set it, and we don't change filters they set without being asked. A
  task from another project therefore yields project AND text = 0, which
  is intentional. For now it shows the basic Block 3 message (`No tasks
  match "{query}".`). The project-aware variant ("No tasks from
  {project} match…") doesn't exist yet; it belongs to Block 5's empty
  states.
- **Pagination count verified, no change.** It already counts rendered
  cards (one task on one day; the same task on N days = N cards). The
  QA figure "19 tasks · 53 days" was the title subtitle, which covers
  the whole range on purpose. Replayed on the Tester data, that same
  project loads 17 days / 30 cards on page 1.

## Task search — fixes after QA, round 2

- **Suggestions also ignore Resultados' date range.** They come from the
  whole history, with no project or date scope. As with the project
  chip, picking a suggestion never touches the date chip, so date AND
  text can come back empty. That outcome is accepted.
- **The Resultados counter now shows "N entries found" (cards), not "N
  tasks found".** It used to show the distinct-task count, the same
  number already in the subtitle, so it added nothing. It also hid how
  much content a filter has: on the Tester data, one project shows
  "19 tasks · 53 days" in the subtitle and 98 entries. An entry is a
  card: one task on one day. That is the unit pagination counts.
  Pagination and the counter share one definition (`cardsByDay`), so
  they can't disagree. The counter covers every match, not the loaded
  pages, so "Load more" doesn't change it. The subtitle is unchanged.

## Resultados — "Load more" keeps the scroll position

- **Cause:** `render()` empties the panel and then awaits
  `resolveTaskIds` (vault reads) before redrawing the days. In that gap
  the panel is shorter than the viewport, so the browser clamps the
  scroll container's `scrollTop` to 0. When the content returns, it
  stays at the top. This is a fixed sequence on every render, not a
  race, so no timing instrumentation was needed.
- **Fix:** the "Load more" click stores the view's scroll position
  (`pendingResultsScrollTop`). `renderResultsSection` restores it once
  the days and the button are back in the DOM. If the user leaves
  Resultados before that render, the value is dropped. Other views'
  scrolling is untouched.

## Task search — Block 5: search empty states and "Searching…"

- **Four empty-state messages when a search is active**, one per
  combination: text, text + project, text + date, text + project +
  date. The Spanish copy quotes the text with «», the English copy with
  "". All four share one icon, Lucide `search-x`, because the text is
  what they have in common. Before this, none of the Resultados empty
  states had an icon. The no-search states (date range only, project
  only, project + date) keep their previous copy and still have no
  icon. The "No project" filter has its own two variants ("No tasks
  without a project match…", with and without "in the selected range").
  The first build reused the named-project template with the filter's
  label, which read "No tasks from No project match…". All six text
  states use the same icon.
- **"Searching…" only on the first paint after confirming a search.**
  `confirmSearch` sets `showSearchLoading`. The text is shown while
  `renderResultsSection` waits on `resolveTaskIds` (note reads, which
  are noticeable on large vaults). It is cleared once a paint completes,
  so it never appears on "Load more" and doesn't affect the restored
  scroll position. Leaving Resultados clears it too. Entries without a
  search never show it. The empty-state check runs before that wait, so
  a search with no matches goes straight to its message.

## Data compatibility between versions (0.0.34)

- **Unknown data is kept everywhere.** Up to 0.0.33, `normalizeState()`
  kept only the fields it knew, so a save from an older device stripped
  whatever a newer version had stored. It now carries unknown fields
  along at every level: top level, settings, projects and entries.
  `normalizeState()` is used both on startup and in the re-read inside
  every `apply()` (the 0.0.31 sync fix, PR #2), so one change covers
  both. Unknown data always comes from the read just made, never from a
  copy kept in memory: re-attaching it from memory would bring back the
  stale-state problem PR #2 fixed (it would resurrect data removed on
  another device). The read → apply only this change → save rule is
  unchanged.
- **Only unknown fields, not unknown values.** A known field with a value
  this version doesn't understand still falls back to its default. Rule
  for every future format change: add new fields, never reuse an
  existing one with a different meaning.
- **Data format mark (`formatVersion`).** Independent from the plugin
  version; it is bumped only when an older version could misread the
  data. Format 1 is everything up to 0.0.34 (data without the mark
  counts as 1). The mark is written on the next real save, never on
  load, and it is never lowered: an older device saving data from a
  newer format keeps the newer mark.
- **Data from a newer format.** Persistent notice once per session (on
  load and when Sync delivers it), exports blocked (they would leave out
  what this version doesn't know), and projects/clients locked in
  Settings, so this device doesn't write them in the old shape. The lock
  is checked inside each `ProjectManager` mutation against the state just
  read, not against memory. Tracking and session edits keep working and
  keep the newer data.
- **One-time heads-up about the next format change.** Shown once per
  device after updating, skipped on a fresh install. The "already shown"
  flag lives in `window.localStorage` (vault name in the key), not in
  `data.json`, so opening Obsidian still never saves.
  `App#saveLocalStorage` would be the vault-scoped API, but it needs
  Obsidian 1.8.7 and `minAppVersion` is 1.7.2.
- **Per-device version left out.** Recording which version each device
  last saved with would need a per-device id and a policy for devices no
  longer in use (they would block a migration forever). Not worth it for
  now.
- **Export lock shown in place, not as a toast.** The export command
  still opens the modal: a warning banner on top (same style as the
  read-only notice in Projects & clients) and every control disabled,
  so nothing typed there is saved either. "Export all" in Settings shows
  the same text as its description, with the button disabled. A toast
  that disappears after a few seconds was too easy to miss. The toast is
  kept only as the last check right before writing, for newer data
  arriving through Sync in between.
- **No "View update" button on the newer-data notices.** Considered a
  button opening the plugin's page via `obsidian://show-plugin?id=…`.
  That action is not in the documented Obsidian URI actions (only the
  plugin directory website uses it), and tested on desktop 1.12.7 in
  Tester it does nothing: the app receives the URL but never processes
  it, unlike the documented `search` action. Opening Settings on the
  plugin page from code would need private API. A link to the web page
  was discarded too: it only shows the listing, and the user would
  still have to go back to Obsidian to update. The notices already say
  what to do.

## Independent client — Block 1: data, Settings, Edit task, export warnings (format 2)

Brief: "Independizar Cliente de Proyecto" (canvas "Cliente independiente",
boards 1, 2, 4 and 6; board 3 belongs to "Proyecto por carpeta").

- **Model.** `clients: Client[]` and `taskClients: taskId -> clientId`,
  parallel to `projects`/`taskProjects` and independent from them: a task
  can have a client and no project. `DATA_FORMAT_VERSION` goes to 2, so a
  0.0.34 device locks project edits and exports on this data instead of
  writing it in the old shape.
- **Migration in memory, deterministic** (`core/ClientMigration.ts`).
  `normalizeState()` migrates format-1 data on every read; the first real
  save persists it. This keeps "opening Obsidian never saves" (0.0.34).
  Because every read migrates again until that save, the output must be
  identical every time, ids included (a client id chosen in the UI from
  one read must exist in the next): client ids are a hash of the
  normalized name, never time or randomness.
- **Merging.** Names that differ only in case or whitespace are merged,
  for clients and projects (`nameKey`: NFC, trim, collapsed spaces,
  lower case; accents are kept, so similar names never merge). The
  spelling with more tasks wins, ties go to the oldest entry. The same
  key enforces unique names in Settings from now on (decided with Liber).
- **Aliases for same-name projects** (decided with Liber). "Web · Acme"
  and "Web · Globex" become one "Web"; the other entries stay in
  `projects` with `aliasOf`, hidden everywhere and resolved by
  `ProjectManager`. Assignments are not rewritten. Why: 0.0.31-0.0.33
  drop the unknown `aliasOf` field when they save, so for them each alias
  turns back into the original pair and each task keeps its own client;
  and the next migration rebuilds the aliases. A single merged project
  could hold only one frozen client text, so recovery would give every
  task of "Web" the same client. Renaming a project renames its aliases;
  deleting it deletes them and their assignments.
- **Frozen client text** (`Project.client`). Never read by format 2
  except by the migration; not updated on client renames. It is what
  older versions show and what a second migration recovers from.
- **Older version overwrote the data.** Checked first, as the brief asks:
  no older version keeps unknown keys at the top level or directly in
  settings (0.0.31-0.0.33 rebuild every level field by field, 0.0.26-0.0.30
  the top level and settings). Only the `settings.toggl`/`settings.clockify`
  sub-objects survive in all of them; storing clients there was rejected
  as a hack. So plan B: each device remembers in local storage the highest
  format it has seen or saved. Format-1 data on a device that already saw
  format 2 means an older version overwrote it: persistent notice once
  per session (update every device; clients recovered from projects;
  changes since then may be lost) and the automatic re-migration does the
  recovery. No "restore from backup" button (decided with Liber): the
  backup predates the migration, so it holds nothing the re-migration
  doesn't, and it only exists on the device that migrated.
- **Backup.** Before the first save that persists a migration,
  `StateStore.apply()` hands the raw data to `StateIO.backup`, written to
  `data-backup-before-format-2.json` in the plugin folder (never in the
  user's notes), never overwritten. A failure is logged and doesn't block
  the save.
- **Notices.** First sight of format-1 data on a device (not a fresh
  install): persistent notice, once per device, saying clients are now a
  list, asking to update every device, and listing merged names (one line
  each). The 0.0.34 "next version changes the format" heads-up is removed.
- **Edit task.** Client row above Project, both through the shared picker
  (`ProjectPickerList`, now generic with `kind`), check mark kept on the
  left (decided with Liber), one-line rows; the project search no longer
  matches clients. "Client updated" reuses the "Project updated" slot.
  Labels and buttons sit on a two-column grid so both buttons line up in
  any language. The canvas's "Note" path line is not built (it belongs to
  "Proyecto por carpeta").
- **Historial card.** Shows the project and/or the client, each from the
  task; order kept as Project, Client until Block 2 decides it.
- **Settings.** "Clients & projects": Clients block above Projects, each
  with title + count, tabs, one-line rows with pencil (rename) and trash;
  the name stays clickable too. Paste list is one name per line,
  all-or-nothing as before.
- **Export warnings** (Toggl and Clockify only; the generic CSV is not
  imported anywhere). Recomputed for the range, format and checkboxes:
  tasks with a client and no project (only if the file has the Client
  column), a project used with several clients in the range ("no client"
  counts as one; only if the file has both columns), and in Clockify
  "Include Client" on with "Include Project" off (text by Liber). Same
  discreet note style as the modal's other notes; never blocking.

## Independent client — fixes after desktop QA (0.0.35)

Source: "Correcciones del QA de Independizar Cliente de Proyecto (0.0.35)".

- **D3, CSV with unusual names: passes.** Generic, Toggl and Clockify
  CSVs, with project/client names holding ";", commas, quotes and line
  breaks (LF and CRLF), parsed back with Python's `csv` module: every
  name whole, in its own column, delimiter sniffed as ",". The three
  adapters quote fields with a quote, comma or line break (RFC 4180);
  ";" needs no quoting with a comma separator. Kept as a test
  (`tests/CsvEscaping.test.ts`, Toggl and Clockify; the generic adapter
  shares the rule but its headers need Obsidian's i18n). So B2 stays as
  decided: lines with ";" are added as plain names, no warning.
- **A1, focus jumping to the tt-id copy button.** The picker popover
  lives in `document.body`, outside the Edit task modal, and keys typed
  in its search box also reached the modal's own handling, which moved
  focus back into the modal. Not reproduced live here (no way to drive
  Obsidian); the popover was mounted the same way in 0.0.34, so it most
  likely happened there too. Two guards: key events from the search box
  don't propagate (except Escape), and if the box loses focus while the
  popover is open without a press or Tab from the user, focus goes back.
- **H1, A1 reopened: search box slow, focus bouncing to the tt-id copy
  button.** Reproduced in real Obsidian this time: Obsidian launched on
  Tester with a local remote-debugging port, driven over the Chrome
  DevTools Protocol by a small Node script (real mouse and key events,
  focus and DOM changes logged per keystroke). Cause: Obsidian keeps
  focus inside an open modal, so with the popover in `document.body` it
  sent focus to the modal's first focusable (the tt-id copy button). In
  0.0.34 that happened once; A1's "focus goes back" guard turned it into
  a loop, both sides moving focus every frame (~75 times a second): keys
  only landed when focus happened to be in the box, hence the lag, the
  flicker and the lost border. Nothing re-rendered on typing (modal,
  sessions and list untouched), so it doesn't depend on session count.
  Fix: from the modal, the popover is attached to `modalEl` (new `modal`
  option), so it's inside the modal for Obsidian and for the modal's
  outside-click guard. A1's two guards and the permanent outside-click
  guard while the popover is open are removed. Escape gets a keymap scope
  on top of the modal's (`new Scope(modal.scope)`, public API), so it
  still closes only the popover, and focus returns to the Client or
  Project button. Checked live: typing and deleting in both boxes, a task
  with 53 sessions, hover, picking a row, a click elsewhere in the modal,
  Escape twice, and the Historial filter (still on `document.body`).
- **A2, delete confirmation on every card.** Already in 0.0.34, by
  design then (stored by task id). Now stored by card (`dayKey|taskId`,
  the expansion key): it opens only where Delete was pressed, opening it
  elsewhere closes the first, confirming still deletes the whole history.
- **A3.** The Dashboard header shows the window's first and last day
  (OS locale dates, year only when the window spans two years).
- **A5.** The "No project"/"No client" rows are left out of the block
  counts. Already counted in 0.0.34 for projects.
- **A4.** The duplicate error is removed in place on the next input (no
  re-render, so the field keeps focus), when adding and renaming.
- **B1.** Paste list is no longer all-or-nothing (it was since the first
  "Configurar proyectos"): new names are added, repeats (against the list
  or within the paste, by `nameKey`) are skipped, and the result lists
  how many were added and every name skipped.
- **B3.** Before: deleting an unused item had no confirmation; a used one
  showed "{count} tasks are using this client. Delete anyway?" (so the
  count was there) and, on Yes, removed only that client's assignments,
  leaving each task's project untouched. The text now also says what
  happens to those tasks.
- **C1/C2.** Export warnings use the theme's warning color (same classes
  as the Clockify duplicates note) and leave room before the Export row's
  divider.
- **C3/C4.** Clockify "Include Project" and "Include Client" default to
  on. Before, both defaulted to off. Settings are merged over defaults on
  load, and every save stores the whole settings object, so in practice
  only installs that never saved anything pick up the new default.
- **D1.** Tester's "By client" totals from the pre-migration backup,
  computed the 0.0.34 way, match the migrated data to the second, both
  over the whole history and over the Dashboard window. The current data
  differs only by changes made during QA (1h 17m 02s that moved from Harrington &
  Voss to Almbridge Consulting, likely a reassigned task, and two new
  Castellan Media sessions).

## Independent client — fixes after mobile QA (0.0.35)

Two findings from the phone QA (Block 7), plus a documentation note from
the two-device simulation (Block 8).

- **Picker search box not focused on touch devices.** The Client and
  Project pickers (Edit task) and the History project filter share
  `openProjectPickerPopover`. It focused the search box on open, which on
  a phone opens the on-screen keyboard over most of the list. Now the
  search box is only focused when `Platform.isMobile` is false. Criterion:
  `Platform.isMobile` (public API, already used elsewhere in the plugin).
  It is true in the mobile app, phones and tablets alike, so a tablet
  behaves like a phone. A touchscreen laptop runs the desktop app, so it
  keeps the desktop behavior (focus on open); the public API cannot tell
  a touch from a click there, and those devices usually have a physical
  keyboard. Checked in real Obsidian against H1: no focus bounce and no
  lag while typing, on desktop (focus on open) and in mobile emulation
  (focus after tapping the search box).
- **Export dialog: email message overlapping the next setting on
  phones.** On mobile, the modal content is a scrolling flex column, and
  when it is taller than the screen its children shrink. A flex item does
  not shrink below its content height by default, but the message's
  explicit `min-height: 1.2em` replaces that automatic minimum, so a
  two-line message was squeezed to one line and its second line spilled
  over "Include Project". Fix: `flex-shrink: 0` on
  `.task-time-tracker-log-edit-message` (also used by the session edit
  form and Settings, where it has no effect or the same benefit). Same
  structure and fix for Toggl. Desktop's modal content is a block, so it
  was never affected.
- **0.0.34 next to 0.0.35.** 0.0.34 keeps format-2 data intact, so 0.0.35
  sees no overwrite and shows no notice. But assigning a project from
  0.0.34 doesn't touch `taskClients`, so that task ends up without a
  client. Documented in the CHANGELOG and README; not handled in code.

## Independent client — Block 2: History filter by client and project (0.0.35)

Board 5 of the "Cliente independiente" canvas. Decisions taken with Liber
before building (7 Nov 2026):

- **One funnel, two tabs.** The filter popover has Client | Project tabs
  (`openFilterTabsPopover` in ProjectPickerList.ts, sharing the popover
  shell with the single-list picker). Each tab is the existing list with
  its search box and a fixed "No client"/"No project" row. Picking a row
  applies the filter and closes the popover; pressing the selected row
  again clears it (`onClearSelected`, filter only: the Edit modal clears
  with its "No …" row). A dot (accent color) marks the tab that isn't open
  when it has a filter on. The popover reopens on the last tab used while
  the panel is open (first time: Client).
- **State.** `listFilters` holds, per list, the id (identity, not name)
  or the "none" filter, in memory only, like the old project filter. Both
  combine with AND, with the text search and with the date range.
- **Chips.** Results: client, project, text, date, each with its "x";
  client and project chips carry their icon. Day/Week: the "View full
  history" row now holds one chip per filter plus the action, which opens
  Results with those filters. On a narrow panel the action wraps below and
  the chips ellipsize (chosen over a separate chip row, which would take
  one more line in the sidebar).
- **Rename / delete with a filter on.** A rename shows at once (names are
  read by id on each render, and Settings refreshes the panel). A filter
  whose client or project no longer exists is dropped on the next render
  (`dropStaleListFilters`), and Results stays open even if it was the
  last filter (see "Results stays open" below). Dropping it also fixes
  the project filter, which used to stay stuck on a deleted project.
- **Search stays name + tt-id only (revised 8 Nov 2026).** A first build
  also matched the client's name, without highlighting it. Block 2 QA
  showed that filtering by a word you can't see in the results is
  confusing, and the funnel already filters by client explicitly, so it
  was removed before release. Project names were never searched (0.0.33
  and 0.0.34 matched name and tt-id only). Keeping one of the two would
  make client and project behave differently for no visible reason, so
  neither is searched; the funnel is the way to narrow by either.
- **Empty states.** Day/Week reuses "No tasks for {project} today/this
  week" with the active names joined ("Acme · Data Analysis"); its button
  says "Remove filters" when both are on. A search with a client filter
  uses the new generic "…with the active filters" text instead of one
  message per combination.
- **Card order.** Client before project, the plugin's single order.
- **Mobile.** The tabs are 40 px tall; the search box isn't focused on open
  or on a tab switch (Block 1 rule), and pressing the open tab hands the
  focus back to the search box on desktop. The current tab uses
  `--interactive-normal`: the popover's own background is black on mobile
  and made the current tab read as a hole.
- **Results stays open when the last filter goes (8 Nov 2026).** Until
  now Results never existed without a filter: removing the last chip
  (client, project, text or date), pressing the selected row again in the
  funnel, or "Remove filters" in its empty state went back to Day/Week.
  0.0.34 did the same with the project filter. Block 2 QA found it
  unexpected: removing the text chip should not take the user out of the
  view, and going back also changed the dates shown without the user
  asking. Now every one of those stays in Results, which then shows the
  whole history unfiltered. The back arrow is the only way back to
  Day/Week, an explicit action. `closeResultsIfNoFilters` is gone.
- **"Since" label (8 Nov 2026).** Results with no date range had nothing
  saying what "the whole history" covers, which mattered more once
  Results can show it with no chip at all. The date chip's slot now
  shows "Since 3 mar 2025" / "Since Mar 3, 2025": faint plain text with no
  ×, since there is nothing to remove. The date is the first session of
  the whole history, not of the filtered results, because the label
  describes the range. Format: the header's day format without the
  weekday, always with the year, and the same locale as the other dates.
  No tooltip. Hidden when there are no sessions.

## Settings — "duplicate setting key" console error (0.0.35, 8 Nov 2026)

Found in the pre-release console check (Block 9). Obsidian 1.15 keys each
row of `getSettingDefinitions()` by its name and logs "duplicate setting
key" when two rows share one. The "Clients & projects" group had two
full-width rows (banner and lists) both named after the heading, since the
declarative settings were adopted in August, so 0.0.34 had it too. No
visible effect (the plugin never calls `update()`), but it showed in red
on every opening of the settings. The banner row is now named after the
banner text; neither name is displayed, as `makeFullWidthRow` empties the
row, and both rows stay out of search.

## Migration notice — merges by spaces and long lists (0.0.35, 8 Nov 2026)

Two findings from the migration test with real data (on a disposable
copy, deleted afterwards).

- **Merges that only differed in spaces are listed.** `fusionOf` used to
  trim each spelling before comparing it with the kept name, so " Acme"
  and "Acme  " were merged without a word and "sales " showed as
  "sales", hiding why it was merged. Every stored spelling other than the
  kept name is now reported as it was. In the notice each name stays in
  its quotes with its spaces visible (`visibleSpaces` in
  ClientMigration.ts): leading, trailing and repeated spaces become
  no-break spaces, because HTML collapses repeated spaces and a line
  could wrap right at an edge space, leaving a lone "“" at the end of a
  line. A single space between words stays normal, so long names still
  wrap. No new text.
- **Long lists scroll inside the notice.** The list of merges (not the
  explanation above it) has `max-height: 40vh` and scrolls. Plan B, a
  list cut at about 8 lines plus "…and N more merges", was not needed:
  in real Obsidian (Tester, synthetic data), the mouse wheel scrolls the
  list on desktop, and on simulated mobile a touch drag scrolls it (with
  touch emulation on; the same drag scrolls a plain control element, and
  CDP's scroll gesture moved neither, so that tool was the problem).
  Obsidian's own `touchstart` handler on the notice doesn't cancel the
  gesture, and the notice stays open while scrolling. With 50 merged
  names the notice stays on screen in a 600 px high window and on a
  phone-size screen. Notices with few merges, none, and the other two
  persistent notices (older version, newer version) look as before; the
  notice colors come from Obsidian and are the same in light and dark.


## Edit task popover off its button with Primary (hotfix 0.0.36, 9 Nov 2026)

Found in published 0.0.35, desktop, Primary theme: the Client and Project
popovers opened at the bottom right of the Edit task modal, and the modal
scrolled (both axes, with scroll bars) to show the focused search box.

- **Cause.** Primary animates every modal with `.modal{animation:
  slideUp forwards}`; `forwards` keeps the last keyframe's
  `transform: translateY(0)` on `.modal` for as long as it is open. Any
  transform makes the element the containing block of its
  `position: fixed` descendants. Since H1, the popover lives in `modalEl`,
  so its window coordinates (`positionPopover`) were applied relative to
  the modal: shifted by the modal's own offset (about 530 × 330 px
  measured), overflowing the modal's scroll area, and `focus()` scrolled
  the modal to reveal the box. Not the glass effect: Primary's
  `backdrop-filter` is on `.modal-container`, which covers the window from
  its corner. Turning on Primary's "Remove Popup and Pop Down Animations"
  (Style Settings) makes it disappear. 0.0.34 was not affected (popover
  in `document.body`); it came with H1.
- **Fix.** The popover is attached to `modal.containerEl` instead of
  `modalEl`: still inside the modal for Obsidian's focus handling, but
  outside the box that scrolls and may carry a theme's transform.
  `positionPopover` now measures where the popover really landed and
  corrects by the difference, so any themed containing block is
  compensated (also for the date picker and search suggestions, which
  live in `document.body` and were unaffected). The search box is focused
  with `preventScroll: true`. No CSS changes.
- **Checked in real Obsidian (Tester, CDP).** Client and Project, a task
  with 1 session and one with 53, Primary animations on and off, wide and
  700 × 700 window: popover aligned with its button, modal scroll 0, no
  horizontal overflow, typing with zero focus changes (H1 not back),
  Escape closes only the popover and returns focus to its button. Tester
  data unchanged.
- **Known, not changed (already in 0.0.34).** In a window too short for
  the popover either below or above its button, it is pinned to the top
  margin and covers the button; after filtering it keeps its first
  position instead of re-anchoring.
