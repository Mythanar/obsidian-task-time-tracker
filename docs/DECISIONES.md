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
- **Icono play/stop junto al checkbox (ítem 2 del backlog de UX):
  arquitectura de doble integración (CodeMirror 6 + post-processor), sin
  forzar reconstrucciones de decoración para la actualización en vivo.**
  Es el primer elemento visual que el plugin dibuja dentro del cuerpo de
  la nota (hasta ahora todo vivía en status bar o panel lateral), y hay
  que cubrir modo Edición (Live Preview) y modo Lectura, que usan
  mecanismos de renderizado completamente distintos — mismo tipo de
  problema que el bug de timing anterior, pero ahora de raíz en el
  diseño en vez de como fix.
  - Modo Edición: una `ViewPlugin` de CodeMirror 6 dibuja un widget por
    cada línea de checkbox visible (ancla justo después de `[x]`/`[ ]`,
    usando la posición calculada por un nuevo helper
    `checkboxMarkerEnd()`). El widget se reconstruye solo cuando cambia
    el texto de la propia línea (`eq()` compara el texto), no en cada
    pulsación de tecla en otras líneas ni en cada movimiento de cursor.
  - Modo Lectura: un `registerMarkdownPostProcessor` empareja en orden de
    documento cada `<li class="task-list-item">` renderizado con su línea
    de origen (vía `ctx.getSectionInfo`), ya que Obsidian no expone un
    mapeo directo línea↔elemento para listas.
  - **Actualización en vivo (número subiendo cada segundo) sin tocar
    decoraciones de CodeMirror.** En vez de reconstruir el widget cada
    segundo (coste y parpadeo innecesarios) o forzar un refresco externo
    de decoraciones cuando cambia el estado de tracking, cada widget se
    monta siempre (tarea abierta, cerrada o sin historial) y decide su
    propio contenido/visibilidad en cada refresco; un pub/sub interno
    (`InlineTrackingBus`) avisa a todos los controles montados —tanto los
    de CodeMirror como los del post-processor— cuando hay que
    releerse (al iniciar/detener tracking, y cada segundo mientras hay
    una sesión activa). Así, cuando una tarea cerrada pasa de "sin
    historial" a "con historial" (justo al detenerse su timer), el badge
    aparece solo actualizando el DOM ya existente, sin recalcular
    decoraciones.
  - **Resolución de la línea en el momento del clic, no al montar el
    control**, para tolerar ediciones intermedias sin arriesgar escribir
    en la línea equivocada: en modo Edición se usa `view.posAtDOM()` +
    `doc.lineAt()` sobre el editor en vivo (siempre exacto); en modo
    Lectura, sin editor disponible, se usa `vault.process()` verificando
    que el texto de la línea no haya cambiado desde que se montó el
    control — si cambió, se aborta con aviso en vez de escribir a
    ciegas.
  - El archivo se resuelve exclusivamente con API pública de Obsidian
    (`editorInfoField` para el path del archivo en CodeMirror,
    `MarkdownRenderChild` + `ctx.addChild` para el ciclo de vida en modo
    Lectura), sin acceder a estructuras internas no documentadas.
