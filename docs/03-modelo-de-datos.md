# 03 · Modelo de datos

Base de datos: **SQLite** con Drizzle ORM. Tipos compartidos en `libs/shared/types`.

## Diagrama

```
Channel ─┬─< Idea ──< Script ──< Scene
         │               │
         │               └──< Production ──< Job
         │                        │
         │                        ├──< Asset ──── DriveFile
         │                        ├──< QaReport
         │                        ├──< CostEntry
         │                        └──< Publication ──< MetricSnapshot
         │
         ├── BrandKit
         ├── VoiceProfile
         ├── VisualStyle
         └──< ScheduleSlot
```

## Entidades

### Channel
| Campo | Tipo | Nota |
|---|---|---|
| id | uuid | |
| name | string | "Fe Diaria" |
| slug | string | carpetas y URLs |
| platform | `tiktok` \| `youtube` | |
| handle | string | @fe.diaria |
| language | string | `es` |
| format | `9:16` \| `16:9` | |
| topic | string | nicho: "oraciones cristianas diarias" |
| bible | text | "biblia del canal": tono, público, qué sí y qué no, ejemplos |
| bibleTranslation | string? | `RV1909` (ver [08](08-nicho-cristiano.md)) |
| durationTarget | {min, max} s | por ejemplo 30–60 |
| brandKitId, voiceProfileId, visualStyleId | fk | |
| driveFolderId | string? | (sin uso: la carpeta del canal se busca por nombre) |
| autoArchive | bool | sube cada video al archivo después de un QA aprobado |
| aiLabel | bool | marcar contenido IA al publicar |
| monetized | bool | bloquea proveedores con licencia no comercial (ADR-008) |
| active | bool | |

### BrandKit
Fuente de títulos y subtítulos, colores (primario, resaltado), estilo de subtítulos (preset ASS), watermark (imagen, posición, opacidad), intro y outro opcionales, pack de música (lista de pistas y volumen), plantilla de miniatura.

**Implementado (Fase 2)**: JSON `channels.brand_kit` con `subtitleFont` (una de `SUBTITLE_FONTS`, archivos OFL en `data/fonts`), `subtitleSize` (56–120 px sobre 1080×1920), `textColor`, `highlightColor` (palabra activa), `outlineColor` y `uppercase`. Un canal sin brand kit usa `DEFAULT_BRAND_KIT`. Se edita en Canal → Identidad con vista previa y entra en el hash de la etapa de subtítulos: cambiarlo rehace subtítulos y render, no la voz ni las imágenes. Watermark, intro/outro, música y miniatura quedan para la Fase 4.

### VoiceProfile
`providerConfigId`, `voiceId`, `language`, `stylePrompt` (Gemini TTS: "cálida, pausada, reverente"), `speed`, `pauseBeforeAmenMs` y otros parámetros específicos del proveedor en JSON. Los valores del canal **se aplican encima** de los valores base, como en ZAP.

### VisualStyle
`source` (`stock` \| `ai-image` \| `ai-video` \| `mixed`), `basePrompt` (estética), `negativePrompt`, `motion` (`kenburns` \| `parallax` \| `static`), `transition`, `hookSource` (por ejemplo, clip de Veo manual para el hook).

### Idea
`channelId`, `title`, `angle`, `embedding` (para detectar temas repetidos), `status` (`new` \| `accepted` \| `rejected` \| `used`), `source` (`gemini` \| `manual` \| `trend`).

### Script
`ideaId`, `channelId`, `hook`, `body`, `cta`, `fullText`, `verseRefs[]`, `metadata` (título, descripción y hashtags por plataforma), `variant` (A/B), `status` (`draft` \| `approved` \| `rejected`), `version`.

### Scene
`scriptId`, `order`, `text` (frase), `visualPrompt`, `assetId?`, `startMs`/`endMs` (se completan después de la voz).

### Production
Una ejecución de un guion para un canal y un formato.

| Campo | Nota |
|---|---|
| scriptId, channelId | |
| stage | etapa actual (ver estados) |
| status | `pending` \| `running` \| `done` \| `failed` \| `canceled` |
| inputHashes | JSON por etapa: base de la idempotencia |
| renderPath, durationMs | |
| freedAt | "Liberar espacio" borró render y voz del disco (siguen en el archivo) |
| costUsd | suma de sus CostEntry |

**Etapas** (`stage`):
```
scripted → voiced → transcribed → visuals_ready → rendered → qa_passed | qa_failed → archived (Drive) → scheduled → published
```

### Job
`productionId?`, `type` (`tts`, `transcribe`, `visuals`, `render`, `qa`, `drive_upload`, `publish`...), `lane` (`gpu` \| `net` \| `cpu`), `status` (`queued` \| `running` \| `done` \| `failed` \| `skipped` \| `canceled`), `priority`, `attempts`, `maxAttempts`, `payload`, `error`, `log`, `startedAt`, `finishedAt`, `durationMs`.

### Asset
`productionId?`, `kind` (`voice` \| `words` \| `subs` \| `scene-image` \| `scene-video` \| `music` \| `render` \| `thumb`), `localPath?`, `sha256`, `sizeBytes`, `provider`, `prompt?`, `reusable` (bool, para el banco de recursos), `tags[]`.

### DriveFile (`remote_files`)
**Implementado (Fase 3)** para cualquier `StorageProvider`: `productionId`, `channelId`, `kind` (`render` | `thumb` | `voice` | `script`), `localName`, `providerConfigId`, `remoteId`, `remotePath`, `md5`, `sizeBytes`, `present` (falso si "Sincronizar" no lo encontró), `syncedAt`. Una fila por producción y tipo. Un recurso se considera **hecho** si existe en disco **o** en el archivo.

### QaReport
`productionId`, `checks[]` (`{name, passed, value, threshold}`), `passed`.

### CostEntry
`productionId?`, `channelId`, `providerConfigId`, `operation`, `units` (caracteres, tokens, imágenes, segundos), `costUsd` (0 si es local), `durationMs`, `createdAt`.

### ProviderConfig
Instancia configurada de un adaptador (ver [13](13-proveedores-intercambiables.md)): `name` ("Ollama · qwen3 4B"), `adapter` (`openai-compatible` \| `gemini` \| `sidecar` \| `command` \| `manual`…), `capabilities[]`, `baseUrl?`, `model?`, `params` (JSON), `secretRef?` (**nombre** de la clave en la bóveda cifrada, por ejemplo `GEMINI_API_KEY`; nunca el valor), `pricingOverride?`, `enabled`, `lastHealth`.

### ProviderBinding
Qué instancia usa cada canal: `channelId?` (vacío = valor global), `capability`, `role?` (`ideas` \| `script` \| `metadata` \| `keywords`, solo para texto), `providerConfigId`, `params` (se aplican encima de los de la instancia), `fallbackIds[]`.

### Publication
`productionId`, `platform`, `accountHandle`, `status` (`draft` \| `scheduled` \| `uploaded_private` \| `published` \| `failed`), `scheduledAt`, `externalId`, `url`, `aiLabeled`.

### MetricSnapshot
`publicationId`, `views`, `likes`, `comments`, `shares`, `avgViewDuration`, `capturedAt`. (Fase 6)

### ScheduleSlot
`channelId`, `weekday`, `time`: cadencia de publicación del canal.

### BibleVerse
`translation`, `book`, `chapter`, `verse`, `text`. Índice por `(translation, book, chapter, verse)` y búsqueda de texto completo (FTS5).
