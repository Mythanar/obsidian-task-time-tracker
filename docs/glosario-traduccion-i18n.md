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
