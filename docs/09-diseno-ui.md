# 09 · Diseño de UI

## Flujo de diseño
1. **Tokens** (colores, tipografía, espaciado, radios, sombras) en pen.dev.
2. **Componentes base**: botón, input, select, tarjeta, badge, barra de progreso, tabla, tabs, kanban card, toast.
3. **Pantallas** en pen.dev (archivo `.pen`), usando solo los componentes.
4. **Implementación** en Angular (`libs/web/ui`) replicando tokens y componentes.

Pen.dev se puede usar directamente desde las sesiones de Claude Code (MCP de Pencil), así el diseño y el código salen del mismo lugar. Google Stitch (Gemini) sirve solo para explorar ideas rápidas, no como fuente de verdad.

## Identidad: editorial moderna, no rústica

Hefesto se expresa con **precisión, no con piedra**: nada de texturas, metal envejecido ni clichés de fragua. Lo "forjado" vive en el lenguaje ("Forjando", "¿Qué forjamos hoy?") y en un único acento incandescente.

**Fuente de verdad:** `design/hefesto.pen` (pen.dev). Pantallas actuales: Hoy (oscuro y claro), Canal (detalle), Producir, Biblioteca (con inspector de escenas y QA), Ideas y guiones (kanban), Cola (línea de tiempo por carril GPU · Red · CPU + tabla de tareas), Drive (almacenamiento, dónde está cada video, liberar espacio, subidas), Calendario (semana por canal), Costos (presupuesto, gasto diario, por proveedor y por canal), Consola (logs en vivo) y Ajustes (proveedores por aspecto: nube, local o manual, con respaldo, "Probar" y "Agregar proveedor"; claves desde .env; límites de la cola), más el tablero de componentes (botones, chip de estado, tag, ítem de navegación, tarjeta de kanban, input, toast) y tres versiones del logo. Vistas previas en `design/previews/`.

Pendientes: pantalla de revisión de video a pantalla completa (overlay de zona segura); el resto de secciones de Ajustes (Voces, Rutas, Cuentas, Sistema, Apariencia).

### Tokens de color (variables con tema `mode: dark | light`)

| Token | Oscuro | Claro | Uso |
|---|---|---|---|
| `bg` | `#0A0A0B` | `#F2F1ED` | fondo de la app y la barra lateral |
| `surface` | `#121214` | `#FFFFFF` | panel principal |
| `surface-2` / `surface-3` | `#19191C` / `#222226` | `#E9E8E2` / `#DEDCD5` | elementos activos, pistas de barras |
| `line` / `line-strong` | `#232327` / `#34343A` | `#DAD8D0` / `#C4C1B7` | bordes de 1 px |
| `text` / `text-2` / `text-3` | `#F3F2EF` / `#A3A29D` / `#8A8984` | `#121211` / `#55534E` / `#76736B` | jerarquía de texto (text-3 ajustado para contraste) |
| `accent` | `#FF5B1F` | `#F04A0C` | **metal fundido**: 1 CTA + el estado "forjando" por vista |
| `ok` / `warn` / `danger` / `steel` | verde / ámbar / rojo / azul acero | versiones más oscuras | estados; cada uno con su variante `-soft` para fondos |
| `sub-highlight` | `#FFD23F` | igual | color de subtítulos del **brand kit** (contenido, no UI) |

### Tipografía

| Rol | Fuente | Uso |
|---|---|---|
| UI | **Geist** | todo el texto de interfaz |
| Datos | **Geist Mono** | etiquetas en mayúsculas, horas, IDs, costos, telemetría |
| Display | **Instrument Serif** (con itálica) | titulares editoriales y números grandes; **una palabra clave por pantalla** en itálica naranja |

### Reglas de estilo
- Un panel principal con esquinas redondeadas sobre el fondo, sin tarjetas dentro de tarjetas.
- Sin gradientes decorativos, glassmorphism ni brillos. Los únicos degradados son los *scrims* sobre las miniaturas, para leer el texto.
- Métricas en línea (números serif + etiqueta), no en "cajitas KPI".
- Las miniaturas 9:16 son las protagonistas: muestran el subtítulo quemado tal como sale en el video.
- Las etiquetas de sección en mono mayúscula con tracking (`TUBERÍA`, `NECESITA ATENCIÓN`).
- Cada miniatura lleva la marca **IA** (regla de etiquetado de contenido).

### Logo
Cabeza de un martillo viejo (con una esquina gastada, expresada solo en la silueta) con el **triángulo de play recortado** en negativo. Un color (`accent`), sin texturas. Versión elegida: **v3**. La v1 (martillo sobre play, con grietas) y la v2 (se parecía al logo de YouTube) quedan descartadas.

Mejoras respecto de ZAP: más aire, jerarquía clara, un solo acento fuerte, y **miniaturas y video como protagonistas** (es una app de contenido visual).

## Estructura de la app

**Barra superior persistente**: producción en curso (qué video, etapa, %, ETA), con pausar, saltar y detener.

**Barra lateral:**

| Sección | Qué muestra |
|---|---|
| **Hoy** | Qué publicar hoy por canal, qué está listo, qué falló, gasto del día |
| **Canales** | Tarjetas por canal (avatar, plataforma, nicho, videos del mes, próximos en calendario) → detalle |
| **Ideas y guiones** | Kanban: Idea → Guion → Aprobado → Producido → Revisado → Publicado |
| **Producir** | Elegir canales, guiones o rango, modo y opciones → resumen con número de tareas, ETA y costo estimado → lanzar |
| **Cola** | Jobs por lane (GPU, red, CPU), reordenar, reintentar |
| **Biblioteca** | Grilla de videos con reproducción inline, filtros por canal y estado, "Rehacer escena" |
| **Calendario** | Vista semanal o mensual por canal, arrastrar para programar |
| **Drive** | Como ZAP: tarjetas + tabla "dónde está cada cosa" + liberar espacio |
| **Costos** | Gasto por proveedor y canal, costo medio por video, presupuesto |
| **Consola** | Logs en vivo, filtrables |
| **Ajustes** | Proveedores y API keys, rutas, verificación de recursos, sistema |

**Pie de la barra lateral**: GPU, VRAM, CPU, disco en vivo (como ZAP).

## Pantalla de detalle de canal
- Cabecera: avatar, nombre, plataforma, handle, nicho.
- Tabs: **Videos** · **Guiones** · **Identidad** (brand kit, voz con botón "probar voz", estilo visual) · **Calendario** · **Métricas**.

## Pantalla de revisión de un video
- Reproductor 9:16 con **overlay de zona segura** de TikTok/Shorts activable.
- Línea de tiempo por escenas: clic en una escena → cambiar imagen, regenerar o editar la frase.
- Panel lateral: guion, metadatos, resultados del QA y costo.
- Acciones: Aprobar · Rehacer etapa · Exportar · Programar.
