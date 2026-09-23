# 09 · Diseño de UI

## Flujo de diseño
1. **Tokens** (colores, tipografía, espaciado, radios, sombras) en pen.dev.
2. **Componentes base**: botón, input, select, tarjeta, badge, barra de progreso, tabla, tabs, kanban card, toast.
3. **Pantallas** en pen.dev (archivo `.pen`), usando solo los componentes.
4. **Implementación** en Angular (`libs/web/ui`) replicando tokens y componentes.

Pen.dev se puede usar directamente desde las sesiones de Claude Code (MCP de Pencil), así el diseño y el código salen del mismo lugar. Google Stitch (Gemini) sirve solo para explorar ideas rápidas, no como fuente de verdad.

## Identidad: "la forja"

Hefesto, dios herrero: metal, fuego contenido, precisión.

| Token | Propuesta inicial |
|---|---|
| Fondo | grafito muy oscuro, casi negro con un leve tinte cálido |
| Superficies | 2–3 niveles de grafito, bordes finos de 1 px |
| Acento primario | **metal fundido**: naranja-ámbar incandescente |
| Acento secundario | acero o azul frío, para estados informativos |
| Éxito / aviso / error | verde, ámbar, rojo desaturados |
| Tipografía UI | sans geométrica y legible |
| Tipografía de datos | monoespaciada para IDs, tiempos y logs |

También hay un tema claro, definido con los mismos tokens. Los valores exactos se fijan en pen.dev.

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
