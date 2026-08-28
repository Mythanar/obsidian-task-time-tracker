// ui/DatePickerPopover.ts
// Selector de fecha (ver nota "Selector de fecha en el panel Time
// Tracker"): icono de calendario junto al navegador de fecha del
// Historial, abre este popover para saltar directamente a un dia o una
// semana concretos, sin recorrer las flechas dia a dia / semana a semana.
// Mismo mecanismo de anclaje que ProjectPickerList.ts (ver
// positionPopover.ts).
//
// Diseno definitivo (agosto 2026, ver Date Filter.dc.html aportado por el
// usuario) — reemplaza el modelo de "seleccion pendiente + boton Aplicar"
// de una iteracion anterior: cada clic (dia, semana, o "Hoy" del pie)
// aplica de inmediato llamando a onChange, sin esperar confirmacion. El
// picker NO se cierra al aplicar, solo con clic fuera (o Escape). Un
// segundo clic en OTRO dia mientras hay un dia pendiente completa un
// rango entre ambos puntos (con su propio aviso en el pie mientras se
// espera ese segundo clic); un clic en un numero de semana siempre
// reemplaza la seleccion por esa semana completa, nunca se une a un dia
// previo para formar rango.
//
// onChange(start, end) es siempre un par: un dia suelto se emite como
// (day, day). El caller (TimeLogView) decide que hacer con el rango:
// start === end -> vista Dia; un rango que coincide exactamente con una
// semana lunes-domingo -> vista Semana (el picker no distingue esto de
// un click directo en el numero de semana, ni falta que hace); cualquier
// otro rango arbitrario no navega todavia — pendiente de "Vista de
// resultados por rango".
//
// El pie tenia hasta agosto 2026 un segundo boton "Limpiar" ademas de
// "Hoy". El filtro de fecha no tiene un "apagado" real (a diferencia del
// filtro de proyecto, la navegacion por fecha siempre muestra algun
// dia/semana, nunca "ninguno"), asi que tras dos iteraciones de QA
// "Limpiar" acabo siendo funcionalmente identico a "Hoy" (mismo
// goToToday()) — dos botones para una sola accion. Eliminado por
// redundante (decision del usuario, fix responsive de cabecera, agosto
// 2026): "Hoy" es ahora el unico punto de salida del filtro de fecha.

import { setIcon } from "obsidian";
import { t } from "../i18n";
import { positionPopover } from "./positionPopover";

export interface DatePickerPopoverOptions {
	anchorEl: HTMLElement;
	// Dia mostrado como seleccion inicial (normalmente el anchorDate del
	// panel) y mes mostrado al abrir.
	selectedDate: number;
	// Fin del rango ya activo en el panel (fix QA agosto 2026 — release
	// 0.0.29: antes de esto, reabrir el picker con una semana o un rango de
	// resultados ya aplicado solo marcaba selectedDate como un dia suelto,
	// perdiendo el resto del rango en el grid aunque el filtro siguiera
	// activo). Opcional: si se omite, se asume selectedDate === fin (dia
	// suelto), que es el comportamiento de siempre para Dia/Semana cuando
	// el caller no tiene un rango que preservar.
	selectedRangeEnd?: number;
	// Se llama en cada clic que resuelve algo (dia, semana o "Hoy"), nunca
	// en el clic que solo arranca un rango a medias — ver comentario de
	// cabecera. start/end en ms (startOfDay); start <= end siempre.
	onChange: (start: number, end: number) => void;
	onClose?: () => void;
}

function addDays(dateAtMidnightMs: number, days: number): number {
	const d = new Date(dateAtMidnightMs);
	return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, 0, 0, 0, 0).getTime();
}

function startOfDay(ms: number): number {
	const d = new Date(ms);
	return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).getTime();
}

// Semana de lunes a domingo — mismo criterio que TimeLogView.ts#startOfWeek
// (duplicado localmente: son cuatro lineas, no justifica un modulo
// compartido solo para esto).
function startOfWeek(ms: number): number {
	const dayStart = startOfDay(ms);
	const weekday = new Date(dayStart).getDay(); // 0 = domingo ... 6 = sabado
	const diffToMonday = weekday === 0 ? -6 : 1 - weekday;
	return addDays(dayStart, diffToMonday);
}

function startOfMonth(ms: number): number {
	const d = new Date(ms);
	return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0).getTime();
}

function addMonths(ms: number, months: number): number {
	const d = new Date(ms);
	return new Date(d.getFullYear(), d.getMonth() + months, 1, 0, 0, 0, 0).getTime();
}

// Numero de semana ISO 8601: se define por el jueves de esa semana (lunes-
// domingo) — el año que contiene ese jueves es el "año ISO", y el numero
// de semana es el dia-del-año del jueves dividido entre 7, redondeado
// hacia arriba.
function isoWeekNumber(weekStartMonday: number): number {
	const thursday = new Date(addDays(weekStartMonday, 3));
	const firstJan = new Date(thursday.getFullYear(), 0, 1);
	const dayOfYear = Math.round((thursday.getTime() - firstJan.getTime()) / 86400000) + 1;
	return Math.ceil(dayOfYear / 7);
}

function formatShortDate(ms: number): string {
	return new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

// Etiqueta del pie: mismo criterio que el label() del diseño definitivo
// (Date Filter.dc.html) — dia suelto ("12 ago"), semana completa
// ("Semana 34 · 12 ago – 18 ago"), rango dentro del mismo mes
// ("12 – 18 ago") o cruzando mes ("12 ago – 18 sep").
function formatSelectionLabel(start: number, end: number): string {
	if (start === end) return formatShortDate(start);

	if (start === startOfWeek(start) && end === addDays(start, 6)) {
		return t("log.datePickerWeekLabel", {
			week: String(isoWeekNumber(start)),
			start: formatShortDate(start),
			end: formatShortDate(end),
		});
	}

	const a = new Date(start);
	const b = new Date(end);
	if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) {
		return `${a.getDate()} – ${formatShortDate(end)}`;
	}
	return `${formatShortDate(start)} – ${formatShortDate(end)}`;
}

// Como mucho un popover de este componente abierto a la vez (igual
// criterio que ProjectPickerList.ts) — abrir uno nuevo cierra el
// anterior. Independiente del singleton de ProjectPickerList: son dos
// tipos de popover distintos, pero cada uno se cierra solo con que el
// click caiga fuera de si mismo, asi que abrir uno mientras el otro esta
// abierto ya lo cierra por el listener de "click fuera" del otro.
let activePopover: {
	anchorEl: HTMLElement;
	popoverEl: HTMLElement;
	options: DatePickerPopoverOptions;
	close: () => void;
} | null = null;

// Reancla el popover activo a un nuevo elemento boton, sin cerrarlo ni
// perder su estado interno (mes mostrado, seleccion pendiente de rango).
// Necesario porque TimeLogView reconstruye su barra de navegacion entera
// desde cero en cada render (container.empty()) — incluido el boton de
// calendario, y ese render se dispara tambien desde el propio onChange de
// este picker al aplicar una seleccion (dia/semana/rango). Sin reanclar,
// tanto el listener de "clic fuera" como el singleton de apertura/cierre
// seguian comparando contra el boton viejo, ya desmontado del DOM: un
// segundo clic en el boton NUEVO se leia a la vez como "fuera" (el
// listener del boton viejo lo cerraba) y como "abrir" (el propio handler
// del boton nuevo), dando la sensacion de que el picker nunca llegaba a
// cerrarse (bug QA agosto 2026). El caller debe llamar a esto tras cada
// render con la referencia fresca al boton — no-op si no hay popover
// abierto.
export function reanchorDatePickerPopover(newAnchorEl: HTMLElement): void {
	if (!activePopover) return;
	activePopover.anchorEl = newAnchorEl;
	activePopover.options.anchorEl = newAnchorEl;
	positionPopover(activePopover.popoverEl, newAnchorEl);
}

export function openDatePickerPopover(options: DatePickerPopoverOptions): void {
	if (activePopover && activePopover.anchorEl === options.anchorEl) {
		activePopover.close();
		return;
	}
	activePopover?.close();

	const popoverEl = document.body.createDiv({ cls: "task-time-tracker-datepicker-popover" });
	let displayMonth = startOfMonth(options.selectedDate);
	let start = startOfDay(options.selectedDate);
	let end = startOfDay(options.selectedRangeEnd ?? options.selectedDate);
	// true entre el primer y el segundo clic de un rango de dias — el pie
	// muestra un aviso mientras tanto (ver formatFooterLabel). Un clic en
	// semana o en "Hoy" siempre lo deja en false: resuelven de inmediato,
	// no son el primer paso de un rango.
	let pending = false;

	const headerEl = popoverEl.createDiv({ cls: "task-time-tracker-datepicker-header" });
	const prevBtn = headerEl.createEl("button", { cls: "clickable-icon" });
	setIcon(prevBtn, "chevron-left");
	prevBtn.setAttribute("aria-label", t("log.datePickerPrevMonth"));
	prevBtn.addEventListener("click", () => {
		displayMonth = addMonths(displayMonth, -1);
		renderGrid();
	});

	const monthLabelEl = headerEl.createSpan({ cls: "task-time-tracker-datepicker-month-label" });

	const nextBtn = headerEl.createEl("button", { cls: "clickable-icon" });
	setIcon(nextBtn, "chevron-right");
	nextBtn.setAttribute("aria-label", t("log.datePickerNextMonth"));
	nextBtn.addEventListener("click", () => {
		displayMonth = addMonths(displayMonth, 1);
		renderGrid();
	});

	// Fila de nombres de dia: grid propio con la misma plantilla de
	// columnas que cada fila de semana (ver renderGrid) — alinean por
	// coincidencia de anchos, no por compartir un unico contenedor.
	const weekdayHeaderEl = popoverEl.createDiv({ cls: "task-time-tracker-datepicker-weekday-header" });
	weekdayHeaderEl.createDiv({ cls: "task-time-tracker-datepicker-cell task-time-tracker-datepicker-weekcol-header" });
	const firstMondayOfWeekRow = startOfWeek(displayMonth);
	for (let i = 0; i < 7; i++) {
		const label = new Date(addDays(firstMondayOfWeekRow, i)).toLocaleDateString(undefined, { weekday: "short" });
		weekdayHeaderEl.createDiv({ text: label, cls: "task-time-tracker-datepicker-cell task-time-tracker-datepicker-weekday" });
	}

	const gridEl = popoverEl.createDiv({ cls: "task-time-tracker-datepicker-grid" });

	const footerEl = popoverEl.createDiv({ cls: "task-time-tracker-datepicker-footer" });
	const footerLabelEl = footerEl.createSpan({ cls: "task-time-tracker-datepicker-footer-label" });
	const footerActionsEl = footerEl.createDiv({ cls: "task-time-tracker-datepicker-footer-actions" });
	const todayBtn = footerActionsEl.createEl("button", { text: t("log.today") });
	todayBtn.addEventListener("click", () => goToToday());

	function onDayClick(dayStart: number): void {
		// Segundo clic en OTRO dia mientras hay un dia pendiente: completa
		// el rango. Cualquier otro caso (sin pendiente, reclic sobre el
		// mismo dia, o ya habia un rango resuelto) arranca un nuevo dia
		// pendiente — solo dia+dia encadenados forman rango.
		if (pending && dayStart !== start) {
			const a = Math.min(start, dayStart);
			const b = Math.max(start, dayStart);
			start = a;
			end = b;
			pending = false;
		} else {
			start = dayStart;
			end = dayStart;
			pending = true;
		}
		options.onChange(start, end);
		renderGrid();
	}

	function onWeekClick(weekStart: number): void {
		start = weekStart;
		end = addDays(weekStart, 6);
		pending = false;
		options.onChange(start, end);
		renderGrid();
	}

	function goToToday(): void {
		const today = startOfDay(Date.now());
		start = today;
		end = today;
		pending = false;
		displayMonth = startOfMonth(today);
		options.onChange(start, end);
		renderGrid();
	}

	function renderGrid(): void {
		const label = new Date(displayMonth).toLocaleDateString(undefined, { month: "long", year: "numeric" });
		monthLabelEl.setText(label.charAt(0).toUpperCase() + label.slice(1));

		gridEl.empty();

		const today = startOfDay(Date.now());
		const firstMonday = startOfWeek(displayMonth);
		const lastOfMonth = addDays(addMonths(displayMonth, 1), -1);

		// Numero de semanas variable segun el mes real (4 a 6), no un
		// numero fijo — cada fila es su propio grid con la misma plantilla
		// de columnas que la cabecera de dias, separadas por un borde
		// superior.
		let weekStart = firstMonday;
		while (weekStart <= lastOfMonth) {
			const thisWeekStart = weekStart;
			const weekEnd = addDays(thisWeekStart, 6);
			const weekNumber = isoWeekNumber(thisWeekStart);
			const weekSelected = thisWeekStart === start && weekEnd === end;

			const rowEl = gridEl.createDiv({ cls: "task-time-tracker-datepicker-week-row" });

			const weekBtn = rowEl.createEl("button", {
				// Prefijo "W" (ver diseño de referencia, Date Filter.dc.html):
				// lo diferencia de un numero de dia a simple vista, no solo por
				// estilo (punto 4, QA agosto 2026).
				text: `W${weekNumber}`,
				cls: "task-time-tracker-datepicker-cell task-time-tracker-datepicker-weeknum",
			});
			weekBtn.toggleClass("is-selected", weekSelected);
			weekBtn.setAttribute("aria-label", t("log.datePickerSelectWeekAriaLabel", { week: String(weekNumber) }));
			weekBtn.addEventListener("click", () => onWeekClick(thisWeekStart));

			for (let day = 0; day < 7; day++) {
				const dayStart = addDays(thisWeekStart, day);
				const isEdge = dayStart === start || dayStart === end;
				const isInside = !isEdge && dayStart > start && dayStart < end;

				const dayBtn = rowEl.createEl("button", {
					text: String(new Date(dayStart).getDate()),
					cls: "task-time-tracker-datepicker-cell task-time-tracker-datepicker-day",
				});
				dayBtn.toggleClass("is-outside-month", new Date(dayStart).getMonth() !== new Date(displayMonth).getMonth());
				dayBtn.toggleClass("is-today", dayStart === today);
				dayBtn.toggleClass("is-selected", isEdge);
				dayBtn.toggleClass("is-in-range", isInside);
				dayBtn.addEventListener("click", () => onDayClick(dayStart));
			}

			weekStart = addDays(weekStart, 7);
		}

		const label_ = pending
			? t("log.datePickerPendingHint", { label: formatSelectionLabel(start, end) })
			: formatSelectionLabel(start, end);
		footerLabelEl.setText(label_);
	}

	renderGrid();
	positionPopover(popoverEl, options.anchorEl);

	const onOutsideMousedown = (evt: MouseEvent) => {
		const target = evt.target as Node;
		if (!popoverEl.contains(target) && !options.anchorEl.contains(target)) close();
	};
	const onKeydown = (evt: KeyboardEvent) => {
		if (evt.key === "Escape") close();
	};

	function close(): void {
		document.removeEventListener("mousedown", onOutsideMousedown, true);
		document.removeEventListener("keydown", onKeydown, true);
		popoverEl.remove();
		activePopover = null;
		options.onClose?.();
	}

	// Igual que en ProjectPickerList.ts: el mousedown que abrio este popover
	// ya ocurrio antes de que este codigo se ejecute, asi que registrar el
	// listener ahora no lo cierra de inmediato consigo mismo.
	document.addEventListener("mousedown", onOutsideMousedown, true);
	document.addEventListener("keydown", onKeydown, true);

	activePopover = { anchorEl: options.anchorEl, popoverEl, options, close };
}
