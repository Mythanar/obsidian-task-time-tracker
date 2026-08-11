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