# 02 · Arquitectura

## Vista general

```
┌──────────────────────────── Electron (apps/desktop) ────────────────────────────┐
│                                                                                  │
│   Angular (apps/web)  ◄──── HTTP + WebSocket/SSE ────►  NestJS (apps/api)       │
│   UI: canales, kanban,                                  proceso hijo             │
│   cola, biblioteca...                                        │                   │
└──────────────────────────────────────────────────────────────┼───────────────────┘
                                                               │
          ┌────────────────────┬───────────────────┬───────────┴──────┬────────────────────┐
          ▼                    ▼                   ▼                  ▼                    ▼
     SQLite (Drizzle)    Proveedores IA       Subprocesos        Google Drive API     Sistema de archivos
     canales, jobs,      Gemini texto/TTS/    ffmpeg.exe         subida, índice        HEFESTO_HOME/
     producciones,       imagen, Pexels,      whisper.exe        de archivos
     costos...           (futuro: sidecar)    (CUDA)
```

## Por qué este stack

- **Todo TypeScript**: tipos compartidos entre la UI y la API, un solo lenguaje y un solo gestor de paquetes.
- **Sin Python**: con 4 GB de VRAM, el TTS local no es práctico. Lo que queda local (Whisper, render) son binarios nativos. Ver [ADR-005](11-decisiones.md).
- **NestJS**: sus módulos calzan con el dominio (canales, cola, proveedores, Drive) y trae DI y WebSockets de fábrica.
- **Angular**: bueno para paneles con formularios complejos y estado reactivo (signals).
- **Electron**: bandeja del sistema, notificaciones nativas, diálogos de archivos, "abrir carpeta" y arranque con Windows.

## Estructura del monorepo (Nx)

```
hefesto-engine-studio/
├─ apps/
│  ├─ web/                 # Angular: UI
│  ├─ api/                 # NestJS: API, cola, pipeline
│  └─ desktop/             # Electron: shell, arranca la API como proceso hijo
├─ libs/
│  ├─ shared/types/        # DTOs y modelos compartidos (Channel, Production, Job...)
│  ├─ shared/constants/    # estados, formatos, límites de plataformas
│  └─ web/ui/              # componentes de UI propios (design system)
├─ tools/
│  └─ fetch-binaries.ts    # descarga ffmpeg + whisper.cpp + modelo a bin/
├─ bin/                    # (gitignored) ffmpeg.exe, whisper.exe, modelos
├─ data/
│  └─ bible/               # Biblia RV1909 (dominio público) para importar
└─ docs/
```

## Módulos de NestJS

| Módulo | Responsabilidad |
|---|---|
| `channels` | CRUD de canales, brand kit, perfil de voz y estilo visual |
| `ideas` | Generación y banco de ideas, detección de temas repetidos |
| `scripts` | Guiones, escenas y metadatos por plataforma, aprobación |
| `productions` | Estado de cada video a lo largo del pipeline |
| `pipeline` | Etapas (voz, subtítulos, visuales, montaje, QA) |
| `queue` | Cola de trabajos persistente en SQLite, workers, pausar, saltar y reintentar |
| `providers` | Implementaciones de `TextProvider`, `TtsProvider`, `ImageProvider`, `VideoProvider` |
| `library` | Listado y búsqueda de recursos generados |
| `drive` | OAuth, subida, índice y sincronización |
| `publishing` | Calendario, exportación y subida a YouTube y TikTok |
| `bible` | Biblia local: búsqueda por referencia y verificación |
| `costs` | Registro y agregación de costos |
| `system` | Telemetría de GPU, VRAM, CPU y disco (`nvidia-smi`), rutas, versiones |
| `events` | Gateway de WebSocket: progreso en vivo, logs, alertas |

## Cola de trabajos

Sin Redis ni BullMQ (ver [ADR-006](11-decisiones.md)). La cola es una tabla `jobs` en SQLite:

- **Worker GPU** (concurrencia 1): Whisper y render NVENC.
- **Worker de red** (concurrencia configurable, 2–4): llamadas a Gemini, TTS en la nube, imágenes, Drive.

El carril de cada job lo define el **proveedor** que lo ejecuta, no el tipo de etapa: un TTS local con GPU (Chatterbox) va al worker GPU; uno en la nube, al de red.
- **Worker CPU** (concurrencia 1–2): tareas de FFmpeg sin GPU, miniaturas, normalización de volumen.

Cada job tiene `status`, `attempts`, `priority`, `payload`, `error` y `startedAt`/`finishedAt`. Pausar deja de tomar jobs nuevos; detener cancela el actual (mata el subproceso); saltar marca el actual como `skipped`.

**Estimación de tiempo**: se guarda la duración de cada etapa y la estimación de una tanda usa la media de las últimas N ejecuciones por tipo de etapa y canal.

## Capa de proveedores

Cada aspecto es una **capacidad** con su interfaz: `TextProvider`, `EmbeddingProvider`, `TtsProvider`, `TranscriptionProvider`, `StockMediaProvider`, `ImageProvider`, `VideoProvider`, `MusicProvider`, `StorageProvider`, `PublishTarget` y `Notifier`. Cualquiera puede ser local, en la nube o manual.

```ts
interface TtsProvider {
  manifest: ProviderManifest;         // capacidades, carril, VRAM, licencia, secretos, precio
  synthesize(input: TtsInput): Promise<TtsResult>;   // { audioPath, durationMs, costUsd }
  listVoices(lang: string): Promise<Voice[]>;
  healthCheck(): Promise<HealthResult>;
}
```

Un `ProviderRegistry` resuelve qué instancia usar según el canal, la capacidad y el rol. El carril de la cola sale del manifiesto. Los modelos en Python (por ejemplo Chatterbox) entran como **sidecar** HTTP, sin tocar el pipeline. Detalle completo en [13 · Proveedores intercambiables](13-proveedores-intercambiables.md).

## Electron

- El proceso principal arranca la API de Nest como **proceso hijo** y abre la ventana con el build de Angular.
- Los binarios (`ffmpeg`, `whisper.cpp` con CUDA) van en los recursos de la app. El modelo de Whisper se descarga en el primer arranque para no inflar el instalador.
- El empaquetado es **la última fase**. Mientras tanto, la app corre como web local (`nx serve web` + `nx serve api`).

## Directorio de trabajo (`HEFESTO_HOME`)

```
HEFESTO_HOME/
├─ hefesto.db
├─ channels/<channel-slug>/
│  └─ productions/<production-id>/
│     ├─ script.json         # guion + escenas + metadatos
│     ├─ voice.wav
│     ├─ words.json          # timestamps por palabra (Whisper)
│     ├─ subs.ass
│     ├─ scenes/             # imágenes o clips por escena
│     ├─ render.mp4
│     ├─ thumb.jpg
│     └─ qa.json
├─ assets/                   # recursos reutilizables (música, fuentes, stock cacheado)
└─ logs/
```

## Variables de entorno

```
HEFESTO_HOME=
GEMINI_API_KEY=
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
PEXELS_API_KEY=
PIXABAY_API_KEY=
# Fase 5
YOUTUBE_*=   # usa el mismo OAuth de Google con otros scopes
TIKTOK_CLIENT_KEY=
TIKTOK_CLIENT_SECRET=
```
