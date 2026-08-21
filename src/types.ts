// types.ts
// Modelo de datos compartido.
// Fase 2 — el vinculo tarea<->sesion es exclusivamente el identificador
// inline tt-id:: (ver core/TaskIdentifier.ts), nunca el texto ni la ruta.
// Fase 3 fix — taskText y filePath son snapshots inmutables tomados al
// iniciar la sesion; nunca se reescriben despues (ni siquiera al cerrar
// la sesion o al trackear la misma tarea desde otra nota).

export interface TimeEntry {
	id: string;
	taskId: string;
	taskText: string;
	filePath: string;
	start: number;
	end: number | null;
}

// Fase 8 — proyectos/clientes para los futuros adapters de exportacion
// (Clockify y otros esperan columnas Project/Client en su importador). La
// identidad unica de un proyecto es la pareja (name, client) completa, no
// el nombre en solitario: dos clientes distintos pueden llamar igual a su
// proyecto (ver core/ProjectManager.ts). client ausente cuenta como su
// propio valor a efectos de esa unicidad (no equivale a client: "").
export interface Project {
	id: string;
	name: string;
	client?: string;
}

// Fase 4 — ajustes de Toggl, campos manuales (nunca se consultan via API).
// Fix urgente pre-release — dateFormat/timeFormat se eliminaron: el
// importador real de Toggl exige un formato fijo (YYYY-MM-DD, HH:MM:SS
// 24h), no admite el que el usuario eligiera aqui. Formato ahora fijo en
// TogglCsvAdapter.ts, no configurable. Si un data.json anterior trae esas
// claves, quedan como propiedades huerfanas sin uso: no se leen, no
// rompen la carga, no se migran.
//
// Fase 8 — opt-in para incluir columnas Project/Client en el CSV de Toggl
// (la generacion de esas columnas es una tarea posterior, bloqueada por
// este ajuste). Desmarcado por defecto: Toggl crea Proyecto/Cliente nuevos
// automaticamente si el nombre no coincide exactamente con uno ya
// existente en la cuenta del usuario, asi que activarlo es una eleccion
// explicita, no el punto de partida.
export interface TogglSettings {
	email: string;
	includeProjectClient: boolean;
}

// Fase 5 — dónde se abre el panel de Historial (TimeLogView). Cambiar
// este ajuste no mueve un panel ya abierto; solo aplica la próxima vez
// que se abra (ver activateLogView() en main.ts).
export type LogViewLocation = "sidebar" | "tab";

// Fase 7 — como se ve el inline field `tt-id::` cuando Dataview lo
// renderiza (Reading mode / Live Preview sin el cursor en la linea).
// Puramente visual (clase en document.body + CSS en styles.css, ver
// applyTaskIdFormatClass() en main.ts); el texto fuente de la nota
// nunca cambia, y sin Dataview instalado no tiene ningun efecto (ver
// SettingsTab.ts).
export type TaskIdFormat = "normal" | "reduced" | "hidden";

export interface PluginSettings {
	toggl: TogglSettings;
	logViewLocation: LogViewLocation;
	// Fase 5 — carpeta dentro de la vault donde ExportManager escribe los
	// CSV generados (ambos formatos, generico y Toggl). Cambiar este ajuste
	// no mueve exportaciones ya hechas en la carpeta anterior; solo aplica
	// a partir de la proxima exportacion.
	exportsFolder: string;
	taskIdFormat: TaskIdFormat;
}

export const DEFAULT_SETTINGS: PluginSettings = {
	toggl: {
		email: "",
		includeProjectClient: false,
	},
	logViewLocation: "sidebar",
	exportsFolder: "task-tracker-exports",
	// Fase 7 — "reducido" es el valor por defecto en una instalacion
	// nueva (decision explicita, no "normal"): la etiqueta completa
	// "tt-id" que renderiza Dataview por defecto es ruido visual para
	// la mayoria de usuarios desde el primer momento.
	taskIdFormat: "reduced",
};

// Fase 5 — resultado de editar los horarios de una sesión desde el
// panel de Historial (ver TimeLogView.ts / main.ts#updateEntryTimes). El
// aviso de solapamiento con otra sesión es puramente informativo y se
// calcula en vivo del lado de la UI mientras se edita (ver TimeLogView.ts);
// nunca bloquea el guardado, así que no forma parte de este resultado.
export type EntryUpdateResult = { ok: true } | { ok: false; error: "not-found" | "invalid-range" };

// Fase 5 — resultado de borrar una tarea completa (todo su historico de
// sesiones, por tt-id) desde el panel de Historial (ver TimeLogView.ts /
// main.ts#deleteTask). Se bloquea si esa tarea tiene la sesion activa en
// este momento; el usuario debe detener el tracking antes de borrar.
export type DeleteTaskResult = { ok: true } | { ok: false; error: "active" };

const EMAIL_REGEX = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

export function isValidEmail(email: string): boolean {
	return EMAIL_REGEX.test(email.trim());
}

// Fase 8 — vinculo tarea<->proyecto, vivo por tt-id (no snapshot): si se
// reasigna, todo el historico de esa tarea adopta el nuevo proyecto al
// instante (ver core/ProjectManager.ts#assignProject). Ausencia de clave
// significa "sin proyecto asignado", no un valor vacio.
export type TaskProjectAssignments = Record<string, string>;

export interface PluginState {
	entries: TimeEntry[];
	settings: PluginSettings;
	projects: Project[];
	taskProjects: TaskProjectAssignments;
}
