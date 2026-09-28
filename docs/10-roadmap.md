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

Avance: MVP (fases 0–2) ≈ 96 % (falta el primer video con claves reales) · Fase 3 ≈ 90 % (falta probar con una cuenta de Google real) · proyecto completo ≈ 48 %.

Hecho el 27-09 (Fase 3, Google Drive):
- [x] `StorageProvider` completo (`put` con progreso, `get`, `exists`, `list`, `location`) con dos adaptadores: **Google Drive** (REST, subida reanudable, MD5 verificado) y **carpeta local o NAS**.
- [x] OAuth de escritorio con PKCE y loopback en Ajustes → Cuentas y OAuth; tokens en la bóveda cifrada.
- [x] Etapa `archive` al final del pipeline (lane del proveedor), automática tras un QA aprobado y opción por canal; "Subir" manual.
- [x] Índice `remote_files`; lo archivado cuenta como hecho y se trae de vuelta si una etapa lo necesita.
- [x] Vista **Drive** (métricas, dónde está cada video, liberar espacio, subir pendientes, subiendo ahora, estructura) y "Traer de vuelta" en la biblioteca.
- [x] Mensajes de clave faltante apuntan a Ajustes, no a `.env`.

Revisión de la Fase 2 (27-09, modo `--offline`):
- [x] Revisadas a mano todas las pantallas; flujo completo idea → guion → aprobar → producir → cola → biblioteca.
- [x] Arreglado: "Generar ideas" quedaba deshabilitado (el `<select>` mostraba un canal que el modelo no tenía).
- [x] Arreglado: "Guardar cambios" del guion nunca se habilitaba al editar.
- [x] Arreglado: el proveedor `fake` no sabía generar ideas (502 en modo offline).
- [x] Endpoint `POST /api/queue/retry-failed` y `QueueState.retryableCount` (solo cuenta fallos no superados).
- [x] CSS de `producir-page` y `hoy-page` dentro del presupuesto (se extrajeron componentes).
- [x] `nx run api:serve` recompila en caliente (el executor `@nx/js:node` chocaba con el chequeo de tareas recursivas de Nx 23).
- [x] **Brand kit** de subtítulos (fuente, tamaño, colores, mayúsculas) en Canal → Identidad, con vista previa y aplicado al render (ver [03](03-modelo-de-datos.md)). Las plantillas de nicho traen el suyo.
- [x] Dependencias explícitas entre etapas: las imágenes dependen solo del guion, así que un cambio de voz o de brand kit ya no vuelve a bajar (ni a pagar) el stock.

### Pruebas a mano pendientes
Todo lo de abajo está cubierto por pruebas automáticas con proveedores simulados, pero nunca se probó contra el servicio real o el hardware real. Hacerlas en cuanto haya claves, cuenta o máquina.

**Claves reales (Gemini y Pexels)**
- [ ] Cargar las claves en Ajustes → Proveedores (o `npx nx run api:cli keys set GEMINI_API_KEY` y `PEXELS_API_KEY`) y volver a los proveedores reales con `setup --reset-bindings`.
- [ ] Producir el primer video real de punta a punta: ideas, guion, voz de Gemini TTS, imágenes de Pexels, render y QA.
- [ ] Comparar el costo registrado (pantalla Producir y `cost_entries`) con lo que marca la consola de Google.
- [ ] Probar voces de Gemini TTS en español y elegir 2–3 para los canales (Fase 0).
- [ ] "Probar" de cada proveedor en Ajustes → Proveedores con claves reales.

**Google Drive con una cuenta real** (ver [06](06-drive.md))
- [ ] En Google Cloud: habilitar la Drive API y crear credenciales OAuth "app de escritorio".
- [ ] Ajustes → Cuentas y OAuth: pegar ID y secreto, "Conectar con Google" y ver que aparece el correo.
- [ ] Un video con QA aprobado se sube solo a `Mi unidad/Hefesto Engine Studio/<Canal> (<Plataforma>)/…` (en modo offline no se vio: el QA del proveedor `fake` falla por duración).
- [ ] "Subir al archivo" de un video con QA fallado y "Subir pendientes" en la vista Drive.
- [ ] Un archivo de más de 8 MB, cortando el wifi a mitad de la subida: tiene que retomar donde quedó y verificar el MD5.
- [ ] "Abrir en Drive" abre la carpeta correcta.
- [ ] Borrar un archivo a mano en Drive → "Sincronizar ahora" → aparece en "Faltan" y "Subir pendientes" lo vuelve a subir.
- [ ] "Liberar espacio" y después "Traer de vuelta" desde Drive; "Rehacer desde Render" de un video liberado trae la voz de Drive sin llamar al TTS.
- [ ] "Desconectar" revoca el acceso (ya no aparece en myaccount.google.com → Seguridad → apps con acceso).
- [ ] Con la pantalla de consentimiento en modo "prueba", a los 7 días el error tiene que pedir "reconectá la cuenta".
- [ ] Usar como carpeta local la carpeta de "Google Drive para escritorio" (alternativa sin OAuth).

**PC con la RTX 3050**
- [ ] `tools/fetch-binaries.ts` baja whisper.cpp CUDA y el modelo `large-v3-turbo`.
- [ ] El render sale con NVENC y Whisper usa CUDA (Ajustes → Sistema / consola).
- [ ] Una sola tarea de GPU a la vez: producir varios videos y ver que Whisper y el render no se pisan (VRAM ≤ 4 GB).

**Laptop con Intel Iris Xe**
- [ ] El render sale con `libx264`, no con QSV: revisar la detección del codificador y probar `h264_qsv` a mano.

### Tareas pendientes
- [ ] Más fuentes OFL para subtítulos en `data/fonts` (hoy solo Archivo Black; se agregan al catálogo `SUBTITLE_FONTS`).
- [ ] Pantalla Ajustes en pen.dev: los campos de clave todavía dicen ".env" (debe decir "cifrada").
- [ ] Mostrar la cuota de espacio de Drive en la vista (el adaptador ya la lee).
- [ ] Luego: Fase 4 (calidad y variación).


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
- [x] CRUD de canales con brand kit, perfil de voz ("probar voz") y estilo visual
- [x] Ideas y guiones con kanban de aprobación
- [x] Cola persistente (lanes GPU, red y CPU), pausar, saltar, detener, reintentar (uno o todos)
- [x] Barra de producción en vivo (WebSocket), consola de logs
- [x] Biblioteca con reproductor
- [x] Pantalla Producir con resumen (tareas, ETA, costo estimado)
- [x] Telemetría de GPU, VRAM, CPU y disco
- ✅ **Entregable**: producir desde la UI sin tocar la consola (probado en modo `--offline`)

## Fase 3 · Google Drive
- [x] OAuth de escritorio (`drive.file`), estructura de carpetas por canal
- [x] Subida reanudable en la lane `net`, `DriveFile`, idempotencia disco + Drive
- [x] Sincronizar, liberar espacio, traer de vuelta
- [x] Vista Drive (tarjetas + tabla "dónde está cada cosa")
- [x] Alternativa sin cuenta: carpeta local, NAS o "Google Drive para escritorio"
- [ ] Probar con una cuenta de Google real
- ✅ **Entregable**: todo lo producido archivado en Drive y el disco liberable (probado con carpeta local y con un Drive simulado)

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
