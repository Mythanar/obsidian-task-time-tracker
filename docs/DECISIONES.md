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
  dos reglas. Verificado con clics reales (Playwright) en ambos
  estados: colapsada, el clic en esa zona ahora cae en el `header`
  (toggle); expandida, sigue abriendo la confirmación de borrado como
  siempre.

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