# 10 · Roadmap

Estimaciones para un desarrollador con asistencia de IA, a ritmo constante de medio tiempo. **MVP útil en ~3 semanas; producto completo en ~9–11 semanas.**

| Fase | Contenido | Duración |
|---|---|---|
| 0 | Planificación y diseño | 1 semana |
| 1 | Pipeline MVP (sin UI) | 1–2 semanas |
| 2 | App base | 2 semanas |
| 3 | Google Drive | 1 semana |
| 4 | Calidad y variación | 1–2 semanas |
| 5 | Publicación y calendario | 1–2 semanas (+ espera de auditorías) |
| 6 | Inteligencia y extras | 1–2 semanas |
| 7 | Empaquetado Electron | 1 semana |

---

## Estado actual (27-09-2026)

Avance: MVP (fases 0–2) ≈ 93 % · proyecto completo ≈ 37 %.

Hecho el 27-09 (revisión de la Fase 2 en el navegador, modo `--offline`):
- [x] Revisadas a mano todas las pantallas; flujo completo idea → guion → aprobar → producir → cola → biblioteca.
- [x] Arreglado: "Generar ideas" quedaba deshabilitado (el `<select>` mostraba un canal que el modelo no tenía).
- [x] Arreglado: "Guardar cambios" del guion nunca se habilitaba al editar.
- [x] Arreglado: el proveedor `fake` no sabía generar ideas (502 en modo offline).
- [x] Endpoint `POST /api/queue/retry-failed` y `QueueState.retryableCount` (solo cuenta fallos no superados).
- [x] CSS de `producir-page` y `hoy-page` dentro del presupuesto (se extrajeron componentes).
- [x] `nx run api:serve` recompila en caliente (el executor `@nx/js:node` chocaba con el chequeo de tareas recursivas de Nx 23).

Pendientes para retomar:
- [ ] **Brand kit** del canal (ver [03](03-modelo-de-datos.md)): no existe en la base ni en la UI. Mínimo para cerrar la Fase 2: fuente y colores de subtítulos aplicados al `subs.ass`, editables en Canal → Identidad. Watermark, intro/outro y música quedan para la Fase 4.
- [ ] Primer video real con claves de Gemini y Pexels (`npx nx run api:cli keys set GEMINI_API_KEY`).
- [ ] Probar en la PC con la RTX 3050: NVENC, whisper.cpp CUDA y el modelo `large-v3-turbo` (`tools/fetch-binaries.ts` elige solo).
- [ ] En la laptop (Intel Iris Xe) el render sale con `libx264`, no con QSV: revisar la detección del codificador.
- [ ] Pantalla Ajustes en pen.dev: los campos de clave todavía dicen ".env" (debe decir "cifrada").
- [ ] Luego: Fase 3 (Google Drive).


## Fase 0 · Planificación y diseño
- [x] Visión, arquitectura, modelo de datos y pipeline documentados
- [ ] Confirmar experiencia previa con Angular y Nest (define el ritmo de las fases 1–2)
- [ ] Proyecto de Google Cloud: Gemini API key, OAuth de escritorio, Drive API
- [ ] API key de Pexels (y Pixabay)
- [ ] Probar voces de Gemini TTS en español y elegir 2–3 para oraciones
- [ ] Conseguir y validar la RV1909 en formato estructurado
- [ ] Definir los 2–3 primeros canales (nombre, plataforma, nicho, "biblia del canal")
- [x] pen.dev: tokens, componentes base y 12 pantallas (ver `design/previews/`)

## Fase 1 · Pipeline MVP (sin UI)
Objetivo: **un comando que produce un short completo** para un canal.
- [x] Nx monorepo con `apps/api` y `libs/shared/types`
- [x] SQLite + Drizzle: Channel, Script, Scene, Production, Asset, CostEntry, BibleVerse
- [x] Importar la RV1909 y crear el módulo `bible`
- [x] Capa de proveedores (ver [13](13-proveedores-intercambiables.md)): manifiesto, `ProviderRegistry`, pruebas de contrato y proveedor `fake`
- [x] Adaptadores: Gemini (texto y TTS), OpenAI-compatible (Ollama y otros), Pexels, whisper.cpp local (el almacenamiento en carpeta local pasa a la Fase 3)
- [x] Etapas: guion (JSON estructurado) → voz → whisper.cpp → `subs.ass` → escenas stock → render FFmpeg (NVENC, QSV, AMF o x264, detección automática)
- [x] Script `fetch-binaries` (ffmpeg, whisper.cpp CUDA, modelo)
- [x] Idempotencia por `inputHash`
- [x] QA básico (duración, WER, volumen, versículos exactos)
- [ ] Probar con claves reales de Gemini y Pexels (falta: claves del usuario)
- ✅ **Entregable**: `nx run api:produce --channel <slug> --count 3` → 3 videos en `HEFESTO_HOME` (probado en modo `--offline`)

## Fase 2 · App base
- [x] `apps/web` Angular con el design system implementado
- [ ] CRUD de canales con brand kit, perfil de voz ("probar voz") y estilo visual (falta el brand kit)
- [x] Ideas y guiones con kanban de aprobación
- [x] Cola persistente (lanes GPU, red y CPU), pausar, saltar, detener, reintentar (uno o todos)
- [x] Barra de producción en vivo (WebSocket), consola de logs
- [x] Biblioteca con reproductor
- [x] Pantalla Producir con resumen (tareas, ETA, costo estimado)
- [x] Telemetría de GPU, VRAM, CPU y disco
- ✅ **Entregable**: producir desde la UI sin tocar la consola (probado en modo `--offline`)

## Fase 3 · Google Drive
- [ ] OAuth de escritorio (`drive.file`), estructura de carpetas por canal
- [ ] Subida reanudable en la lane `net`, `DriveFile`, idempotencia disco + Drive
- [ ] Sincronizar, liberar espacio, traer de vuelta
- [ ] Vista Drive (tarjetas + tabla "dónde está cada cosa")
- ✅ **Entregable**: todo lo producido archivado en Drive y el disco liberable

## Fase 4 · Calidad y variación
- [ ] QA automático completo (WER, versículos, LUFS, silencios, zona segura, formato)
- [ ] Subtítulos animados (karaoke, palabras clave resaltadas) con presets por canal
- [ ] Música con ducking, watermark, intro y outro
- [ ] Imágenes IA (`GeminiImageProvider`) y banco de recursos reutilizables
- [ ] Variantes de hook A/B, plantillas por formato (ver [08](08-nicho-cristiano.md))
- [ ] Detección de temas repetidos con embeddings
- [ ] Revisión de video: línea de tiempo por escenas, "Rehacer escena"
- [ ] Vista previa en baja resolución
- ✅ **Entregable**: videos de calidad "publicable sin tocar"

## Fase 5 · Publicación y calendario
- [ ] Panel de exportación con metadatos listos para copiar
- [ ] Calendario por canal (`ScheduleSlot`), pantalla **Hoy**
- [ ] YouTube: subida por API (privada hasta pasar la auditoría)
- [ ] TikTok: registrar la app, subida a borradores o privada, solicitar la auditoría
- [ ] Etiquetado de contenido IA
- ✅ **Entregable**: flujo de publicación semi-automático

## Fase 6 · Inteligencia y extras
- [ ] Métricas (YouTube Analytics; TikTok según la API disponible)
- [ ] Panel de costos + alerta de presupuesto
- [ ] Ideas basadas en lo que funcionó (top videos → nuevas ideas similares)
- [ ] Webhooks de salida (para n8n) y notificaciones (Telegram o Windows)

## Fase 7 · Empaquetado Electron
- [ ] `apps/desktop`: arranque de la API como proceso hijo, bandeja, notificaciones, "abrir carpeta"
- [ ] Binarios empaquetados, descarga del modelo de Whisper en el primer arranque
- [ ] Instalador para Windows, autoarranque opcional
- ✅ **Entregable**: `Hefesto Engine Studio Setup.exe`
