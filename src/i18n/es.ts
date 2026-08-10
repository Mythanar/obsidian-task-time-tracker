// i18n/es.ts
// Fase 6 — diccionario en espanol. Tipado contra TranslationKey (derivado
// de en.ts): si falta una clave o sobra una, el build falla en vez de
// dejar un hueco de traduccion silencioso. Contenido y claves fijados en
// docs/glosario-traduccion-i18n.md.

import { TranslationKey } from "./en";

export const es: Record<TranslationKey, string> = {
	// 1. Paleta de comandos (src/main.ts)
	"cmd.start": "Iniciar tracking en la tarea actual",
	"cmd.stop": "Detener tracking activo",
	"cmd.openLog": "Abrir panel de historial",
	"cmd.export": "Exportar registros de tiempo...",

	// 2. Status bar (src/ui/StatusBarWidget.ts)
	"statusbar.idle": "Sin tracking activo",

	// 4. Modal de recuperacion (src/ui/RecoveryModal.ts)
	"recovery.title": "Sesión de tracking sin cerrar",
	"recovery.body": 'Tenías "{taskText}" corriendo desde {datetime}. ¿Qué quieres hacer?',
	"recovery.closeNow": "Cerrar ahora",
	"recovery.keepGoing": "Seguir corriendo",

	// 5. Modal de exportacion (src/ui/ExportModal.ts)
	"export.title": "Exportar sesiones",
	"export.from": "Desde",
	"export.to": "Hasta",
	"export.formatLabel": "Formato",
	"export.formatGeneric": "CSV genérico",
	"export.formatToggl": "CSV para Toggl",
	"export.togglEmailLabel": "Email de Toggl",
	"export.emailPlaceholder": "tu@email.com",
	"export.emailRequired": "El email de Toggl es obligatorio para exportar en este formato.",
	"export.emailInvalid": "Ese email no tiene un formato válido (ej. usuario@dominio.com).",
	"export.rangeInvalid": "Selecciona un rango de fechas válido.",
	"export.fromAfterTo": 'El campo "Desde" no puede ser posterior a "Hasta".',
	"export.emailInvalidNotice": "Completa un email de Toggl válido antes de exportar con este formato.",
	"export.exportButton": "Exportar",

	// 6. Settings (src/settings/SettingsTab.ts)
	"settings.logLocation.name": "Ubicación del Historial",
	"settings.logLocation.desc": "Dónde se abre el panel de Historial. Si ya está abierto, el cambio se aplica la próxima vez que lo abras.",
	"settings.logLocation.sidebar": "Panel lateral",
	"settings.logLocation.tab": "Pestaña central",
	"settings.exportFolder.name": "Carpeta de exportación",
	"settings.exportFolder.desc": "Carpeta dentro de la vault donde se guardan los archivos exportados. Se crea automáticamente si no existe todavía.",
	"settings.exportAll.name": "Exportar todo",
	"settings.exportAll.desc": "Tu historial vive solo en este dispositivo. Usa este botón para tener una copia de seguridad en cualquier momento.",
	"settings.exportAll.button": "Exportar todo",
	"settings.toggl.heading": "Toggl",
	"settings.toggl.email.name": "Email de Toggl",
	"settings.toggl.email.placeholder": "tu@email.com",
	"settings.toggl.email.descValid": "Necesario para exportar sesiones en formato CSV para Toggl.",
	"settings.toggl.dateFormat.name": "Formato de fecha",
	"settings.toggl.dateFormat.iso": "ISO (AAAA-MM-DD)",
	"settings.toggl.dateFormat.dmy": "DD-MM-AAAA",
	"settings.toggl.dateFormat.mdy": "MM-DD-AAAA",
	"settings.toggl.timeFormat.name": "Formato de hora",
	"settings.toggl.timeFormat.24h": "24 horas",
	"settings.toggl.timeFormat.12h": "12 horas (AM/PM)",

	// 7. Historial (src/ui/TimeLogView.ts)
	"log.title": "Time Tracker",
	"log.taskNotFound": "Tarea no encontrada",
	"log.emptyAll": "Todavía no hay sesiones registradas.",
	"log.emptyDay": "Sin sesiones este día.",
	"log.session.singular": "sesión",
	"log.session.plural": "sesiones",
	"log.ongoing": "en curso",
	"log.save": "Guardar",
	"log.cancel": "Cancelar",
	"log.delete": "Eliminar",
	"log.deleteSessionConfirm": "¿Eliminar esta sesión? Esta acción no se puede deshacer.",
	"log.deleteSessionYes": "Sí, eliminar",
	"log.errorFormat": "Revisa la fecha y las horas: usa el formato HH:MM:SS.",
	"log.errorRange": "La hora de fin debe ser posterior a la de inicio.",
	"log.errorGone": "No se pudo guardar: la sesión ya no existe.",
	"log.warnOverlap": "Aviso: este horario se solapa con otra sesión guardada.",
	"log.deleteTaskConfirm": "¿Eliminar esta tarea y todo su histórico de sesiones (todas las fechas)? Esta acción no se puede deshacer.",
	"log.deleteTaskYes": "Sí, eliminar",
	"log.deleteBlockedActive": "No se puede eliminar: esta tarea tiene una sesión activa. Detén el tracking primero.",
	"log.deleteTaskAriaLabel": "Eliminar tarea",
	"log.viewDay": "Día",
	"log.viewWeek": "Semana",
	"log.today": "Hoy",
	"log.navPrevDay": "Día anterior",
	"log.navNextDay": "Día siguiente",
	"log.navPrevWeek": "Semana anterior",
	"log.navNextWeek": "Semana siguiente",

	// 8. Notices adicionales (src/main.ts, src/ui/TimeLogView.ts)
	"notice.noActiveSession": "No hay ninguna sesión de tracking activa.",
	"notice.notATask": "La línea actual no es una tarea (checkbox).",
	"notice.taskClosed": "Esta tarea ya está cerrada; no se puede trackear.",
	"notice.alreadyTracking": "Esta tarea ya se está trackeando.",
	"notice.exportSuccess": "Exportado a {filePath}",
	"notice.exportError": "Ocurrió un error al exportar. Revisa la consola para más detalles.",
	"notice.noSessionsYet": "No hay sesiones guardadas todavía.",
	"notice.noteNotFound": "No se encontró ninguna nota con esta tarea.",
};
