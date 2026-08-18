# Contexto del proyecto: Task Time Tracker

Plugin de Obsidian en TypeScript para trackear tiempo de tareas (checkboxes,
formato compatible con el plugin Tasks) de forma LOCAL, con exportacion
manual y por lotes a plataformas externas (Toggl y otras a futuro).

## Reglas de arquitectura no negociables
1. Local-first: ningun flujo de start/stop depende de red.
2. Exportacion = generacion de archivos (CSV u otros formatos) compatibles
   con el importador nativo de cada plataforma externa (Toggl, Clockify,
   Harvest, etc.). El plugin NUNCA llama a ninguna API externa, en ningun
   punto del codigo, no solo fuera de ExportManager. Nunca sync en tiempo
   real. El usuario sube el archivo manualmente a la plataforma que
   corresponda, usando el importador que esa plataforma ya ofrece.
3. El modelo de datos vive en data.json del plugin (saveData/loadData de la
   API de Obsidian), no se escribe estado interno en las notas del usuario,
   salvo el identificador inline necesario para vincular la tarea. Formato
   confirmado en Fase 2: `[tt-id:: <id>]`, con corchetes (requerido por
   Dataview para reconocerlo como inline field estructurado), id nanoid
   alfanumerico de 8 caracteres.
4. No aplica gestion de tokens/credenciales de API dentro del plugin, ya
   que ningun adapter de exportacion llama a una API externa. Tampoco
   aplica idempotencia via `externalId` de una plataforma remota — cada
   adapter de exportacion genera un archivo nuevo e independiente; evitar
   duplicados al importarlo es responsabilidad del usuario y/o del propio
   importador de cada plataforma (algunas, como Toggl, ya deduplican por
   su cuenta filas identicas en fecha/hora de inicio).
5. Un solo timer activo a la vez (no tracking paralelo) en el MVP.
6. La vault del usuario es su casa, no la nuestra. Cualquier cosa que el
   plugin escriba o dibuje dentro de una nota (identificadores inline,
   badges, marcas de cualquier tipo) debe justificar su presencia, y por
   defecto debe usar la opcion menos intrusiva que siga siendo funcional.
   Si hace falta dejar una marca visible, el aspecto por defecto es el
   mas discreto posible sin romper la funcion; ir a un aspecto mas
   visible o mas completo es una eleccion explicita del usuario (via
   Settings), nunca el punto de partida de una instalacion nueva. Ejemplo
   aplicado: el `[tt-id:: <id>]` se renderiza (via Dataview) en estilo
   Reducido por defecto, con Normal y Oculto como opciones explicitas en
   Settings > Task identifier format.
7. Los releases los decide y los dispara el usuario, nunca Claude Code por
   iniciativa propia. No subas la version en manifest.json/package.json, no
   crees tags de git, ni prepares o publiques un release salvo que el
   usuario lo pida explicitamente y diga cuando. Dejar una funcionalidad
   terminada y lista no equivale a cortar el release que la incluye —
   son dos decisiones distintas, y la segunda se espera siempre.

## Estructura de carpetas
/src
  main.ts                 # entry point del plugin, registra comandos y vistas
  /core
    TrackingEngine.ts      # start/stop, timer activo, persistencia de entries
    TaskIdentifier.ts      # genera/lee el id inline [tt-id:: <id>], resuelve conflictos
    ProjectManager.ts       # alta/baja de proyectos y clientes, y el vinculo
                             # tarea<->proyecto (vivo por tt-id, ver brief
                             # "Asignar proyectos")
  /ui
    StatusBarWidget.ts      # timer activo en status bar
    TimeLogView.ts          # panel lateral con historial (tarjeta de solo
                             # lectura: icono de nota, menu kebab, linea de
                             # sesiones expandible — ver brief "Editar tarea
                             # desde el Historial")
    EditTaskModal.ts         # unica via de gestion de una tarea: reasignar
                              # Proyecto/Cliente, editar/borrar sesiones
    sessionEdit.ts            # funciones puras de fecha/hora y el renderer
                               # de solo lectura de una sesion, compartidos
                               # entre TimeLogView.ts y EditTaskModal.ts
    ExportModal.ts           # modal de seleccion de rango y formato de destino
  /export
    ExportManager.ts        # orquesta exportacion, elige el adapter de formato
    /adapters
      CsvAdapter.ts          # CSV generico, agnostico de plataforma (Fase 3)
      TogglCsvAdapter.ts      # genera CSV con las columnas que espera el
                               # importador oficial de Toggl (Fase 4). No llama
                               # a la API de Toggl en ningun momento.
      (futuros: ClockifyAdapter.ts — investigado pero pausado, ver nota abajo —,
       HarvestAdapter.ts, EverhourAdapter.ts, TimelyAdapter.ts, etc. — mismo
       patron: generar el archivo que el importador de cada plataforma espera,
       sin tocar su API)
  /settings
    SettingsTab.ts           # configuracion del plugin (formato de export,
                              # carpeta de destino, formato del tt-id, seccion
                              # por plataforma como Toggl). No gestiona tokens/
                              # API keys de ninguna plataforma externa.
    ProjectsSection.ts        # seccion "Projects & clients": alta, edicion
                               # y borrado de la lista de proyectos (uno por
                               # uno o pegando una lista)
  /i18n
    en.ts, es.ts             # diccionarios de traduccion (Fase 6). Ingles por
                              # defecto, espanol si Obsidian esta en ese idioma.
                              # NO se traduce: el identificador `[tt-id:: <id>]`
                              # inline, las columnas de los CSV de exportacion,
                              # ni los nombres de archivos/carpetas de export.
  types.ts

## Estado actual
Fases 0 a 7 completadas. Plugin publicado en el listado de Community Plugins
de Obsidian, release `0.0.26` (primer y unico release hasta la fecha).
README con contenido e ilustraciones completos, licencia MIT, verificado en
movil, bug del doble panel corregido. Ver docs/DECISIONES.md para el detalle
fase a fase.

**Trabajo en curso — "Proyectos" (funcionalidad de producto nueva, no
pre-release):** introduce el concepto de proyecto/cliente que faltaba desde
Fase 3, dividido en tres piezas independientes:
- **Configurar proyectos** — alta, edicion y borrado de la lista de
  proyectos en Settings. Construida y verificada por el usuario en
  Obsidian (agosto 2026).
- **Asignar proyectos** — vincular una tarea a un proyecto desde el
  Historial. Construida: la UI vive en el nuevo modal "Editar tarea"
  (ver brief "Editar tarea desde el Historial", que absorbio tambien el
  rediseno de la tarjeta del Historial y la edicion de sesiones — ver
  EditTaskModal.ts). Vinculo vivo por tt-id (`PluginState.taskProjects`),
  no snapshot: reasignar actualiza el historico completo al instante.
- **Filtro por proyecto en el Historial** — necesaria antes de un futuro
  release, aparcada por ahora.

**Investigacion de plataformas — Clockify pausado.** Confirmado con una
prueba real (agosto 2026): el plan Free de Clockify importa proyectos,
clientes, tareas y tags via CSV sin problema, pero **no importa entradas de
tiempo** — esa funcion requiere plan Basic o superior. El adapter de Clockify
queda pausado hasta decidir como tratar ese muro de pago. Harvest, Everhour
y Timely siguen sin investigar.

## Como trabajar
- Construye por fases segun el roadmap, no todo de una vez.
- Antes de construir el adapter de exportacion de cada plataforma (Toggl,
  Clockify, etc.), confirma con el usuario el formato exacto que espera su
  importador (columnas, estructura, requisitos de cuenta/permisos) —
  mismo principio de "investigar antes de codear" que regia para la API,
  aplicado ahora a formato de archivo en vez de a endpoints.
- Antes de dar por viable el adapter de una plataforma con plan gratuito y
  de pago, confirma que la funcion concreta que necesitas (importar
  entradas de tiempo, no solo estructura) esta disponible en el plan
  gratuito — que una plataforma "tenga importador CSV" no significa que el
  plan Free lo soporte para todo. Leccion de Clockify, agosto 2026.
- Usa la API publica de Obsidian (Plugin, Notice, ItemView, addCommand,
  addStatusBarItem, loadData/saveData); evita hacks sobre el DOM interno
  de Obsidian salvo que sea estrictamente necesario.
- Sigue las convenciones del plugin de ejemplo oficial de Obsidian
  (obsidian-sample-plugin) para manifest.json, esbuild config y estructura.
- Ante cualquier bug que dependa de timing o de estado en memoria (p. ej.
  varios paneles con la misma nota abierta a la vez), instrumenta con
  logging temporal con timestamps antes de proponer un fix — no se
  diagnostica a ciegas. Retira el logging antes de cualquier commit.