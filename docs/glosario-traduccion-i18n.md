# Glosario de traducción — Fase 6 (i18n)

Inglés = idioma por defecto. Español = solo si Obsidian está configurado en español.
El español que aparece aquí es el texto **congelado tal cual estaba en el código** (no se ha corregido redacción, salvo excepción señalada al final).

Uso previsto: uno o dos archivos de traducción (`en.json` / `es.json` o equivalente), con una clave por fila de este glosario. El nombre exacto de cada clave y la implementación técnica quedan a criterio de Claude Code — este documento fija el **contenido**, no la estructura del código.

---

## 1. Paleta de comandos

Fichero: `src/main.ts`

| Clave sugerida | Español | Inglés (ya en el código) |
|---|---|---|
| cmd.start | Iniciar tracking en la tarea actual | Start tracking on current task |
| cmd.stop | Detener tracking activo | Stop active tracking |
| cmd.openLog | Abrir panel de historial | Open time log panel |
| cmd.export | Exportar registros de tiempo... | Export time entries... |

> Nota: en el código estos 4 `name` de comando ya están en inglés (convención habitual de Obsidian para la paleta de comandos, mezclada con la de otros plugins). El texto en español es la traducción nueva a añadir, no una traducción inversa de algo que hubiera que cambiar en el código en inglés.

---

## 2. Status bar

Fichero: `src/ui/StatusBarWidget.ts`

| Clave sugerida | Español | Inglés |
|---|---|---|
| statusbar.idle | Sin tracking activo | No active tracking |

| Elemento | Tipo | Nota |
|---|---|---|
| `⏱ {taskText} — {duración}` | Plantilla, no se traduce | `⏱`, `—` y el formato `HH:MM:SS` son universales; `{taskText}` es el texto de la tarea (no se traduce, es contenido del usuario) |

---

## 3. Icono/badge del checkbox

Fichero: `src/ui/InlineTaskControl.ts`

Sin texto que traducir. Solo iconos (`play` / `square`) y el número `HH:MM:SS`. No tiene `title` ni `aria-label` en ningún estado (hueco de accesibilidad ya señalado, ver apartado 8).

---

## 4. Modal de recuperación al reabrir (RecoveryModal)

Fichero: `src/ui/RecoveryModal.ts`

| Clave sugerida | Español | Inglés |
|---|---|---|
| recovery.title | Sesión de tracking sin cerrar | Unclosed tracking session |
| recovery.body | Tenías "{taskText}" corriendo desde {fecha/hora}. ¿Qué quieres hacer? | You had "{taskText}" running since {date/time}. What do you want to do? |
| recovery.closeNow | Cerrar ahora | Close now |
| recovery.keepGoing | Seguir corriendo | Keep tracking |

> `{fecha/hora}` usa `toLocaleString()` — se adapta sola al idioma/región del sistema, no necesita traducción.

---

## 5. Modal de exportación (ExportModal)

Fichero: `src/ui/ExportModal.ts`

| Clave sugerida | Español | Inglés |
|---|---|---|
| export.title | Exportar sesiones | Export sessions |
| export.from | Desde | From |
| export.to | Hasta | To |
| export.formatLabel | Formato | Format |
| export.formatGeneric | CSV genérico | Generic CSV |
| export.formatToggl | CSV para Toggl | Toggl CSV |
| export.togglEmailLabel | Email de Toggl | Toggl email |
| export.emailPlaceholder | tu@email.com | you@email.com |
| export.emailRequired | El email de Toggl es obligatorio para exportar en este formato. | Toggl email is required to export in this format. |
| export.emailInvalid | Ese email no tiene un formato válido (ej. usuario@dominio.com). | That email isn't a valid format (e.g. user@domain.com). |
| export.rangeInvalid | Selecciona un rango de fechas válido. | Select a valid date range. |
| export.fromAfterTo | El campo "Desde" no puede ser posterior a "Hasta". | The "From" field can't be later than "To". |
| export.emailInvalidNotice | Agrega el email de tu cuenta de Toggl antes de exportar | Add your Toggl account email before exporting |
| export.exportButton | Exportar | Export |

> ✅ **Fix de redacción aplicado:** `export.emailInvalidNotice` — texto actualizado en `src/i18n/es.ts`/`en.ts` tanto en español como en inglés.

---

## 6. Settings (General + Toggl)

Fichero: `src/settings/SettingsTab.ts`

### Sección General (sin encabezado visible)

| Clave sugerida | Español | Inglés |
|---|---|---|
| settings.logLocation.name | Ubicación del Historial | Time Log location |
| settings.logLocation.desc | Dónde se abre el panel de Historial. Si ya está abierto, el cambio se aplica la próxima vez que lo abras. | Where the Time Log panel opens. If it's already open, the change applies next time you open it. |
| settings.logLocation.sidebar | Panel lateral | Sidebar |
| settings.logLocation.tab | Pestaña central | Center tab |
| settings.exportFolder.name | Carpeta de exportación | Export folder |
| settings.exportFolder.desc | Carpeta dentro de la vault donde se guardan los archivos exportados. Se crea automáticamente si no existe todavía. | Folder inside the vault where exported files are saved. Created automatically if it doesn't exist yet. |
| settings.exportAll.name | Exportar todo | Export all |
| settings.exportAll.desc | Tu historial vive solo en este dispositivo. Usa este botón para tener una copia de seguridad en cualquier momento. | Your history only lives on this device. Use this button to get a backup anytime. |
| settings.exportAll.button | Exportar todo | Export all |

### Sección Toggl

| Clave sugerida | Español | Inglés |
|---|---|---|
| settings.toggl.heading | Toggl | Toggl |
| settings.toggl.email.name | Email de Toggl | Toggl email |
| settings.toggl.email.placeholder | tu@email.com | you@email.com |
| settings.toggl.email.descValid | Necesario para exportar sesiones en formato CSV para Toggl. | Required to export sessions in Toggl CSV format. |
| settings.toggl.email.descInvalid | Ese email no tiene un formato válido (ej. usuario@dominio.com). | *(misma clave que `export.emailInvalid`)* |
| settings.toggl.dateFormat.name | Formato de fecha | Date format |
| settings.toggl.dateFormat.iso | ISO (AAAA-MM-DD) | ISO (YYYY-MM-DD) |
| settings.toggl.dateFormat.dmy | DD-MM-AAAA | DD-MM-YYYY |
| settings.toggl.dateFormat.mdy | MM-DD-AAAA | MM-DD-YYYY |
| settings.toggl.timeFormat.name | Formato de hora | Time format |
| settings.toggl.timeFormat.24h | 24 horas | 24-hour |
| settings.toggl.timeFormat.12h | 12 horas (AM/PM) | 12-hour (AM/PM) |

---

## 7. Historial (TimeLogView)

Fichero: `src/ui/TimeLogView.ts`

### 7.1 Cabecera del panel

| Clave sugerida | Español | Inglés |
|---|---|---|
| log.title | Time Tracker | Time Tracker |

> ✅ **Decisión cerrada:** "Time Tracker" es un nombre fijo, igual en los dos idiomas (no se traduce). Hoy son dos textos distintos en el código — título de pestaña fijo en inglés (`getDisplayText()`) y encabezado interno en español ("Historial de tracking"). Deben pasar a leer de esta misma clave única. Esto es un cambio de código, no solo de contenido: ambos sitios deben usar la misma fuente, y el encabezado interno cambiará de texto el primer día de Fase 6, incluso en español.

### 7.2 Tarjetas de tarea

| Clave sugerida | Español | Inglés |
|---|---|---|
| log.taskNotFound | Tarea no encontrada | Task not found |
| log.emptyAll | Todavía no hay sesiones registradas. | No sessions recorded yet. |
| log.emptyDay | Sin sesiones este día. | No sessions this day. |
| log.session.singular | sesión | session |
| log.session.plural | sesiones | sessions |

Sin traducción necesaria (símbolos/datos dinámicos): fecha (`toLocaleDateString()`), snapshot del texto de tarea, `tt-id`.

> ✅ **Decisión cerrada:** el total agregado de la cabecera de tarjeta (y el de la confirmación de borrado de tarea completa, ver 7.4 — ambos comparten la misma clase CSS `task-time-tracker-totals-duration`) deja de usar `HH:MM:SS` y pasa a un formato compacto sin ceros a la izquierda vía `formatDurationCompact()` (`src/core/TrackingEngine.ts`, separada de `formatDuration()`): `14m 45s`, `1h 45m`, `127h 49m` — nunca la unidad "días", acumulando siempre en horas. Sin segundos salvo que el total sea menor a 1 minuto (`8s`), tanto para no aportar precisión irrelevante a esa escala como para que el ancho del total no cambie cada segundo mientras hay tracking activo sumando en vivo. Las abreviaturas `h`/`m`/`s` NO pasan por `t()`: se tratan como formato/símbolo universal, igual que ya se decidió para `HH:MM:SS`, `→` y `+1` — válidas sin cambio en español e inglés. Las filas de sesión individuales y el formulario de edición NO cambian: siguen en `HH:MM:SS` (ver 7.3), porque ahí el segundo sigue siendo un dato relevante y el ancho fijo importa para la alineación en columna.

### 7.3 Fila de sesión y formulario de edición

| Clave sugerida | Español | Inglés |
|---|---|---|
| log.ongoing | en curso | ongoing |
| log.editStartDateLabel | Fecha inicio | Start date |
| log.editStartTimeLabel | Hora inicio | Start time |
| log.editEndDateLabel | Fecha fin | End date |
| log.editEndTimeLabel | Hora fin | End time |
| log.editDurationLabel | Duración calculada | Calculated duration |
| log.save | Guardar | Save |
| log.cancel | Cancelar | Cancel |
| log.delete | Eliminar | Delete |
| log.deleteSessionConfirm | ¿Eliminar esta sesión? Esta acción no se puede deshacer. | Delete this session? This action can't be undone. |
| log.deleteSessionYes | Sí, eliminar | Yes, delete |
| log.errorFormat | Revisa la fecha y las horas: usa el formato HH:MM:SS. | Check the date and times: use the HH:MM:SS format. |
| log.errorRange | La hora de fin debe ser posterior a la de inicio. | End time must be after start time. |
| log.errorGone | No se pudo guardar: la sesión ya no existe. | Couldn't save: this session no longer exists. |
| log.warnOverlap | Aviso: este horario se solapa con otra sesión guardada. | Note: this time overlaps with another saved session. |

Sin traducción necesaria: `→` (separadores) y `+1` (badge medianoche) — ambos solo en la fila estática de sesión, ya no en el formulario de edición (ver nota abajo); `—` (duración sin cerrar/no calculable todavía), placeholder `HH:MM:SS`.

> ✅ **Rediseño del formulario de edición inline:** ahora agrupa los campos en parejas etiquetadas con icono (fecha inicio/hora inicio, fecha fin/hora fin), todas como texto libre — incluida la fecha, que deja de ser un `<input type="date">` nativo y de inferirse por comparación de horas. Decisión revisada respecto a la original de Fase 5 Bloque 1 ("la fecha de fin nunca se edita directamente"); ver `DECISIONS.md`. Añade un bloque de "Duración calculada" que sustituye a la vista previa junto a los campos, y separa "Eliminar sesión" del resto de botones con una línea divisoria.

### 7.4 Confirmación de borrado de tarea completa

Reutiliza `log.session.singular/plural`, `log.cancel` y patrón de sesión ya definidos arriba. Textos nuevos de esta pantalla:

| Clave sugerida | Español | Inglés |
|---|---|---|
| log.deleteTaskConfirm | ¿Eliminar esta tarea y todo su histórico de sesiones (todas las fechas)? Esta acción no se puede deshacer. | Delete this task and its entire session history (all dates)? This action can't be undone. |
| log.deleteTaskYes | Sí, eliminar | Yes, delete |
| log.deleteBlockedActive | No se puede eliminar: esta tarea tiene una sesión activa. Detén el tracking primero. | Can't delete: this task has an active session. Stop tracking first. |
| log.deleteTaskAriaLabel | Eliminar tarea | Delete task |

### 7.5 Navegación por fecha

| Clave sugerida | Español | Inglés |
|---|---|---|
| log.viewDay | Día | Day |
| log.viewWeek | Semana | Week |
| log.today | Hoy | Today |
| log.navPrevDay | Día anterior | Previous day |
| log.navNextDay | Día siguiente | Next day |
| log.navPrevWeek | Semana anterior | Previous week |
| log.navNextWeek | Semana siguiente | Next week |

> ✅ **Implementado:** `aria-label` de las flechas anterior/siguiente, antes ausente (ver apartado 10, punto 3). El texto depende de la vista activa (Día/Semana) para que un lector de pantalla sepa si el botón retrocede/avanza un día o una semana, no un texto genérico fijo.

Sin traducción necesaria: fecha del día, encabezados de sección semanal y separador `–` del rango semanal — todos generados con `toLocaleDateString()`, se adaptan solos al idioma del sistema.

---

## 8. Notices adicionales (detectados en el barrido completo de `src/`)

Ficheros: `src/main.ts` y `src/ui/TimeLogView.ts`. `src/core/` y `src/export/` confirmados sin texto de cara al usuario.

| Clave sugerida | Español | Inglés | Dónde |
|---|---|---|---|
| notice.noActiveSession | No hay ninguna sesión de tracking activa. | No active tracking session. | main.ts:141 — comando "Stop" sin sesión activa |
| notice.notATask | La línea actual no es una tarea (checkbox). | The current line isn't a task (checkbox). | main.ts:196 — iniciar tracking fuera de un checkbox |
| notice.taskClosed | Esta tarea ya está cerrada; no se puede trackear. | This task is already closed; it can't be tracked. | main.ts:201 |
| notice.alreadyTracking | Esta tarea ya se está trackeando. | This task is already being tracked. | main.ts:214 |
| notice.exportSuccess | Exportado a {filePath} | Exported to {filePath} | main.ts:317 y 350 (mismo texto, dos sitios, una sola clave) |
| notice.exportError | Ocurrió un error al exportar. Revisa la consola para más detalles. | An error occurred while exporting. Check the console for details. | main.ts:320 y 353 (mismo texto, dos sitios, una sola clave) |
| notice.noSessionsYet | No hay sesiones guardadas todavía. | No sessions saved yet. | main.ts:336 — botón "Exportar todo" sin datos |
| notice.noteNotFound | No se encontró ninguna nota con esta tarea. | Couldn't find a note for this task. | TimeLogView.ts:716 — clic en título sin nota resuelta |
| notice.newerFormat | Tus datos vienen de una versión más reciente de Task Time Tracker. Actualiza el plugin en este dispositivo; hasta entonces, la exportación y la edición de proyectos están desactivadas. | Your data comes from a newer version of Task Time Tracker. Update the plugin on this device; until then, export and project editing are turned off. | main.ts#checkNewerDataFormat — al abrir o al llegar por Sync |
| export.newerFormat | Exportación desactivada: tus datos vienen de una versión más reciente de Task Time Tracker y el archivo saldría incompleto. Actualiza el plugin en este dispositivo para exportar. | Export is turned off: your data comes from a newer version of Task Time Tracker and the file would be incomplete. Update the plugin on this device to export. | ExportModal.ts (aviso del modal) y SettingsTab.ts (descripción de «Exportar todo»), con exportación bloqueada |
| settings.projects.newerFormat | Solo lectura: tus datos vienen de una versión más reciente de Task Time Tracker. Actualiza el plugin en este dispositivo para editar proyectos y clientes. | Read-only: your data comes from a newer version of Task Time Tracker. Update the plugin on this device to edit projects and clients. | ProjectsSection.ts — aviso sobre la lista en solo lectura |

> `notice.exportSuccess` es la única clave nueva con parte dinámica (`{filePath}`, la ruta del archivo generado) — mismo mecanismo de interpolación que ya usa `recovery.body`.

---

## 9. Fuera del alcance de traducción (decisiones ya cerradas)

- **`[tt-id:: <id>]`** inline en las notas del usuario — nunca se traduce.
- **Columnas del CSV de Toggl** (`Email`, `Description`, `Start date`, `Start time`, `Duration`) — nunca se traducen, las lee el importador nativo de Toggl.
- **Columnas del CSV genérico** (`export.csv.header*` en `src/i18n/`) — **decisión revertida** (agosto 2026): SÍ se traducen, siguen el idioma de Obsidian igual que el resto de la interfaz. No hay importador externo que le imponga nombres fijos; es de propósito general. Solo `tt-id` (la última columna) queda fuera de la traducción, por ser un identificador técnico.
- **Nombres de archivos y carpetas de exportación** (`task-tracker-exports`, `task-tracker-export_...csv`) — nunca se traducen.
- **`name` / `description` del `manifest.json`** — fijo en inglés siempre, no entra en el sistema de i18n (Obsidian no soporta metadata de plugin por idioma). Pendiente de que el usuario lo revise cuando lo tenga a mano.

## 10. Cabos sueltos detectados durante el repaso

1. ✅ Fix de redacción del mensaje `export.emailInvalidNotice` en español (apartado 5) — aplicado, junto con su traducción al inglés.
2. ✅ Unificación de la clave `log.title` — decisión cerrada ("Time Tracker" en ambos idiomas). Pendiente solo de implementación (apartado 7.1).
3. ✅ `aria-label` de las flechas de navegación anterior/siguiente del Historial — implementado, dinámico según Día/Semana (apartado 7.5).
4. ✅ `estado-fase-5.md` y `DECISIONS.md` — entrada retroactiva de "Exportar todo" ya añadida a `DECISIONS.md`, sin tocar `estado-fase-5.md` (ya la tenía).
5. ⏳ `name`/`description` del `manifest.json` — pendiente de que el usuario lo pase para revisarlo. Queda fijo en inglés, no entra en el sistema de i18n.
6. ✅ Decisión de fechas del Historial (`toLocaleDateString`/`toLocaleTimeString`) — se quedan dependiendo del sistema operativo, sin forzar el idioma de Obsidian. Cerrado, sin cambio de código.

### Glosario cerrado ✅

Con la incorporación del apartado 8 (Notices), el barrido de `src/` está completo: `core/` y `export/` sin texto de usuario, y el resto de ficheros ya cubiertos pantalla por pantalla. Listo para pasar a la fase de implementación (`src/i18n/`, `moment.locale()`, `t()`).

## 11. Independent client (0.0.35)

Every text that is new or changed in this piece, for Liber's review (QA block 1). Columns: Spanish, English, where it shows, and what it is meant to explain. Removed: `notice.formatChangeAhead` and the `Project; Client` paste-list texts (`settings.projects.clientPlaceholder`, `pasteHelp`, `importPlaceholder`, `importButton`, `importError`).

Texts 1, 6, 8, 27-30 and 36-39 of Liber's review were rewritten on 1 Nov 2026 (QA note, section F); "¶" marks a blank line between paragraphs. The Clockify checkbox help (last two rows) was rewritten for C5, since both checkboxes are now checked by default.

| Español | Inglés | Dónde sale | Qué se quiere explicar |
|---|---|---|---|
| Task Time Tracker: los clientes son ahora una lista independiente, separada de los proyectos. Cada tarea conserva su cliente original. ¶ Actualiza el plugin en todos tus dispositivos para evitar perder los clientes asignados. | Task Time Tracker: clients are now an independent list, separate from projects. Each task keeps its original client. ¶ Update the plugin on all your devices to avoid losing the assigned clients. | Aviso fijo al abrir por primera vez en cada dispositivo (main.ts#checkDataFormat) | Contar que el cliente ya no va dentro del proyecto, que no se ha perdido nada y que hay que actualizar todos los dispositivos, porque una versión antigua borraría los clientes. |
| Se han unido nombres que solo se diferenciaban en mayúsculas o espacios: | Names that only differed in capital letters or spaces were merged: | Mismo aviso, antes de la lista de fusiones (solo si hubo fusiones) | Explicar por qué faltan algunos nombres: se han unido variantes que solo cambiaban en mayúsculas o espacios. |
| Cliente | Client | Cada línea de fusión: «• Cliente «Acme» ← «acme»» | Decir si la fusión es de un cliente o de un proyecto. |
| Proyecto | Project | Cada línea de fusión | Igual que la anterior, para proyectos. |
| «{name}» | “{name}” | Comillas alrededor de los nombres en el aviso de fusiones y en el resultado de «Paste list» | Que se vea dónde empieza y acaba cada nombre (los espacios importan), con las comillas de cada idioma. |
| Task Time Tracker: una versión antigua del plugin sobrescribió tus datos. ¶ Los clientes se han recuperado a partir de tus proyectos; los cambios de cliente hechos desde la actualización pueden haberse perdido. ¶ Actualiza el plugin en todos tus dispositivos para evitar perder los clientes asignados. | Task Time Tracker: an older version of the plugin overwrote your data. ¶ Clients were recovered from your projects; client changes made since the update may have been lost. ¶ Update the plugin on all your devices to avoid losing the assigned clients. | Aviso fijo, una vez por sesión, si una versión antigua pisó los datos | Que la pérdida nunca sea silenciosa: qué ha pasado, qué hacer (actualizar todo) y qué se ha recuperado o puede haberse perdido. |
| Clientes y proyectos | Clients & projects | Ajustes: título de la sección | El cliente va primero en todo el plugin; el título sigue ese orden. |
| Usa los nombres exactos de cliente y proyecto de tu plataforma de seguimiento (Toggl, Clockify...) para poder importarlos sin generar duplicados. | Use the exact client and project names from your tracking platform (Toggl, Clockify...) so you can import them without creating duplicates. | Ajustes: banner informativo de la sección | Recordar que los nombres deben coincidir exactamente con los de Toggl o Clockify para que la importación los case. |
| Clientes | Clients | Ajustes: título de la lista de clientes | Nombrar la lista. |
| Proyectos | Projects | Ajustes: título de la lista de proyectos | Nombrar la lista. |
| cliente | client | Ajustes: contador junto al título («4 clients») | Ver de un vistazo cuántos hay. |
| clientes | clients | Ajustes: contador junto al título | Igual, en plural. |
| proyecto | project | Ajustes: contador junto al título (antes «project saved») | Igual que en clientes; se quita «saved» porque ya no hay un contador aparte bajo la lista. |
| proyectos | projects | Ajustes: contador junto al título (antes «projects saved») | Igual, en plural. |
| Nombre del cliente | Client name | Ajustes: campo de «One by one» en Clients | Indicar qué se escribe ahí. |
| Un cliente por línea | One client per line | Ajustes: caja de «Paste list» en Clients | Explicar el formato: un nombre por línea. |
| Un proyecto por línea | One project per line | Ajustes: caja de «Paste list» en Projects (sustituye al ejemplo «Proyecto; Cliente») | El formato antiguo desaparece; un nombre por línea. |
| Añadir clientes | Add clients | Ajustes: botón de «Paste list» en Clients | Decir qué hace el botón con lo pegado. |
| Añadir proyectos | Add projects | Ajustes: botón de «Paste list» en Projects (antes «Import list») | Igual que en clientes. |
| 1 cliente añadido. | 1 client added. | Ajustes: resultado bajo la caja tras pegar | Confirmar cuántos nombres se han añadido. |
| {count} clientes añadidos. | {count} clients added. | Ajustes: resultado bajo la caja tras pegar | Igual, en plural. |
| 1 proyecto añadido. | 1 project added. | Ajustes: resultado bajo la caja tras pegar | Igual, para proyectos. |
| {count} proyectos añadidos. | {count} projects added. | Ajustes: resultado bajo la caja tras pegar | Igual, en plural. |
| Omitidos por estar ya en la lista o repetidos: {names}. | Skipped, already in the list or repeated: {names}. | Ajustes: segunda línea del resultado, en color de aviso, solo si se omitió alguno | Decir cuáles no se han añadido y por qué, todos, para que nadie piense que se han perdido. |
| El nombre del cliente es obligatorio. | Client name is required. | Ajustes: error al añadir o renombrar con el campo vacío | Pedir un nombre. |
| Ya existe un cliente con este nombre. | A client with this name already exists. | Ajustes: error al añadir o renombrar un cliente que ya existe (sin distinguir mayúsculas ni espacios) | Evitar dos clientes que las plataformas tratarían como distintos o el usuario como iguales. |
| Ya existe un proyecto con este nombre. | A project with this name already exists. | Ajustes: mismo error para proyectos (antes hablaba de «combinación de proyecto y cliente») | Igual; ya no hay parejas proyecto-cliente. |
| Editar cliente | Edit client | Ajustes: botón lápiz (lector de pantalla y tooltip) | Nombrar el botón de editar. |
| Editar proyecto | Edit project | Ajustes: botón lápiz | Igual, para proyectos. |
| Guardar cliente | Save client | Ajustes: botón de confirmar al renombrar | Nombrar el botón de guardar. |
| Eliminar cliente | Delete client | Ajustes: botón papelera | Nombrar el botón de borrar. |
| Este cliente está asignado a 1 tarea. Si lo eliminas, esa tarea se queda sin cliente. | This client is assigned to 1 task. If you delete it, that task will have no client. | Ajustes: confirmación al borrar un cliente usado en 1 tarea | Decir a cuántas tareas está asignado y qué les pasa (se quedan sin cliente). Solo sale si hay tareas: sin tareas se borra directamente. |
| Este cliente está asignado a {count} tareas. Si lo eliminas, esas tareas se quedan sin cliente. | This client is assigned to {count} tasks. If you delete it, those tasks will have no client. | Ajustes: confirmación al borrar un cliente usado en N tareas | Igual, en plural. |
| Este proyecto está asignado a 1 tarea. Si lo eliminas, esa tarea se queda sin proyecto. | This project is assigned to 1 task. If you delete it, that task will have no project. | Ajustes: confirmación al borrar un proyecto usado en 1 tarea | Igual: se quedan sin proyecto. |
| Este proyecto está asignado a {count} tareas. Si lo eliminas, esas tareas se quedan sin proyecto. | This project is assigned to {count} tasks. If you delete it, those tasks will have no project. | Ajustes: confirmación al borrar un proyecto usado en N tareas | Igual, en plural. |
| Cliente | Client | Editar tarea: etiqueta de la fila Client | Nombrar el selector. |
| Sin cliente | No client | Editar tarea: botón sin cliente y fila fija del desplegable | Dejar claro que no tener cliente es una opción válida y cómo quitarlo. |
| Cliente actualizado | Client updated | Editar tarea: mensaje breve al cambiar el cliente | Confirmar que el cambio se ha guardado (aplica a todo el historial de la tarea). |
| Buscar cliente | Search client | Editar tarea: buscador del desplegable de cliente | Indicar qué se busca. |
| Buscar proyecto | Search project | Editar tarea y filtro del Historial: buscador del desplegable de proyecto (antes «Search project or client») | El proyecto ya no lleva cliente; el buscador solo busca proyectos. |
| En el rango seleccionado, 1 tarea tiene cliente pero no proyecto; sus sesiones se importarán sin cliente. Para evitarlo, asígnale un proyecto en Obsidian o rellena la columna Project del archivo exportado. | In the selected range, 1 task has a client but no project; its sessions will be imported without a client. To avoid this, assign it a project in Obsidian or fill in the Project column of the exported file. | Exportar (Toggl y Clockify): aviso en color de aviso, si 1 tarea del rango tiene cliente y no proyecto | Avisar de que esas sesiones llegarán sin cliente y dar las dos salidas (asignar proyecto o rellenar la columna). |
| En el rango seleccionado, {count} tareas tienen cliente pero no proyecto; sus sesiones se importarán sin cliente. Para evitarlo, asígnales un proyecto en Obsidian o rellena la columna Project del archivo exportado. | In the selected range, {count} tasks have a client but no project; their sessions will be imported without a client. To avoid this, assign them a project in Obsidian or fill in the Project column of the exported file. | Exportar: igual, para N tareas | Igual, en plural. |
| En Clockify, el cliente depende del proyecto: sin «{label}», las sesiones se importarán sin proyecto y también sin cliente. Actívalo para conservarlos. | In Clockify, a client depends on its project: with “{label}” off, sessions will be imported without a project, and without a client too. Turn it on to keep them. | Exportar (Clockify): «Include Client» activado e «Include Project» desactivado ({label} es el nombre de la casilla) | Avisar de que todos los clientes se perderían y sugerir activar la casilla del proyecto. Texto de Liber. |
| En el rango seleccionado, hay tareas donde un mismo proyecto está asignado a varios clientes diferentes. Al importarlos, se creará un proyecto por cliente, con el mismo nombre. | In the selected range, some tasks use the same project with different clients. On import, one project per client will be created, all with the same name. | Exportar: si en el rango un proyecto aparece con varios clientes | Avisar de que la plataforma creará un proyecto por cliente, todos con el mismo nombre. |
| {from} – {to} | {from} – {to} | Dashboard: fechas junto a «Last 30 days» («3 oct – 1 nov») | Dejar claro qué días cuenta el Dashboard: siempre los 30 hasta hoy, sea cual sea el rango del panel. |
| Añade el proyecto de cada tarea como columna en el CSV de Clockify. Es opcional: desmárcala si no usas proyectos en Clockify; las sesiones se importarán sin proyecto. | Adds each task's project as a column in the Clockify CSV. It's optional: uncheck it if you don't use projects in Clockify; sessions will then be imported without a project. | Exportar (Clockify) y Ajustes > Clockify: ayuda de «Include Project» (mismo texto en settings.clockify.includeProject.desc) | Qué añade la casilla y qué pasa si se desmarca, coherente con que ahora viene marcada por defecto. |
| Añade el cliente de cada tarea como columna en el CSV de Clockify. Es opcional: desmárcala si no usas clientes en Clockify. Clockify solo conserva el cliente si la sesión también lleva su proyecto. | Adds each task's client as a column in the Clockify CSV. It's optional: uncheck it if you don't use clients in Clockify. Clockify only keeps the client if the session also has its project. | Exportar (Clockify) y Ajustes > Clockify: ayuda de «Include Client» (mismo texto en settings.clockify.includeClient.desc) | Igual, y recordar que Clockify solo conserva el cliente junto con su proyecto. |
