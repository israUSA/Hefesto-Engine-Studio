# 04 · Pipeline de producción

```
1 IDEA → 2 GUION → [aprobación] → 3 VOZ → 4 TRANSCRIPCIÓN → 5 VISUALES → 6 MONTAJE → 7 QA → 8 DRIVE → 9 PUBLICAR
```

## Idempotencia (regla general)

Cada etapa:
1. Calcula el `inputHash` de sus entradas (texto, parámetros, proveedor, versión de la plantilla).
2. Si la salida existe (en disco **o** en Drive) con el mismo hash, la **salta**.
3. Si cambió algo (por ejemplo el perfil de voz), solo se rehacen esa etapa y las siguientes.

Esto permite **"Rehacer escena 3"** o **"Rehacer solo la voz"** sin volver a producir todo.

## 1 · Idea
- Entrada: `Channel.topic` + `Channel.bible` + ideas previas.
- Gemini propone N ideas. Se calcula el embedding de cada una y se **descartan las muy parecidas** a ideas usadas (umbral de similitud coseno configurable).
- El usuario acepta o rechaza en lote.

## 2 · Guion
- Gemini genera, con salida JSON estructurada:
  - `hook` (≤ 3 s, ~8 palabras), `body`, `cta`
  - `scenes[]`: frase + `visualPrompt`
  - `verseRefs[]` (solo referencias, ver [08](08-nicho-cristiano.md))
  - metadatos por plataforma: título, descripción, hashtags
- Opcional: 2–3 **variantes de hook** (A/B).
- Longitud objetivo según `Channel.durationTarget` (~2.5 palabras por segundo en español).
- **Aprobación**: kanban. Solo los guiones `approved` entran a la cola.

## 3 · Voz (TTS)
- Proveedor según `VoiceProfile` (por defecto Gemini TTS).
- Se sintetiza por fragmentos (frases o escenas) y se concatena, con reintentos por fragmento.
- Post-proceso con FFmpeg: recortar silencios largos, pausas configurables (por ejemplo antes del "Amén") y ajuste de velocidad.

## 4 · Transcripción (subtítulos)
- `whisper.cpp` con CUDA, modelo `large-v3-turbo` cuantizado (entra en 4 GB).
- Salida: `words.json` con timestamps por palabra.
- Alineación con el guion: se usa **el texto del guion** (no el de Whisper) con los tiempos de Whisper, para evitar errores ortográficos en los subtítulos.
- Genera `subs.ass`:
  - estilo del BrandKit, 1–3 palabras por línea
  - palabra activa resaltada (karaoke) y palabras clave en color
  - posición dentro de la **zona segura** (ver QA)

## 5 · Visuales
- Una escena por frase o bloque; su duración sale de los tiempos de Whisper.
- Según `VisualStyle.source`:
  - **stock**: búsqueda en Pexels o Pixabay con palabras clave generadas por Gemini
  - **ai-image**: Gemini o Imagen, con `basePrompt` + `visualPrompt`
  - **ai-video**: solo el hook, con un clip de Veo generado a mano en Flow e importado
- Todo se guarda en el **banco de recursos** con etiquetas para reutilizarlo.

## 6 · Montaje (render)
- FFmpeg con `h264_nvenc`:
  - Ken Burns o parallax sobre imágenes, recorte a 1080×1920 (o 1920×1080)
  - transiciones cortas (xfade)
  - subtítulos quemados con libass
  - música del pack del canal, con **ducking** (`sidechaincompress`) bajo la voz
  - watermark
- Especificación de salida: H.264 High, 30 fps, 8–12 Mbps, AAC 48 kHz 192 kbps, `+faststart`.
- **Miniatura**: frame elegido + título con la plantilla del canal.
- **Vista previa**: render en baja resolución (540×960, preset rápido) antes del final, opcional.

## 7 · QA automático
| Check | Criterio (configurable) |
|---|---|
| Coincidencia audio-guion | WER de la transcripción contra el guion ≤ 8 % |
| Versículos exactos | cada `verseRef` aparece literal en el guion y coincide con la Biblia local |
| Duración | dentro de `Channel.durationTarget` |
| Volumen | −14 LUFS integrado ±1, true peak ≤ −1 dBTP (`loudnorm`) |
| Silencios | ningún silencio > 1.2 s dentro de la voz |
| Zona segura | subtítulos fuera del ~20 % inferior y del ~15 % derecho (interfaz de TikTok y Shorts) |
| Archivo | resolución, fps, códec y tamaño esperados |

Si falla, la producción queda en `qa_failed` con el motivo y un botón para **reintentar solo la etapa culpable**.

## 8 · Drive
Subida del render, la miniatura, la voz y `script.json`, más el registro en `DriveFile`. Ver [06](06-drive.md).

## 9 · Publicar
Exportación con metadatos, o subida por API cuando esté disponible. Ver [07](07-publicacion.md).
