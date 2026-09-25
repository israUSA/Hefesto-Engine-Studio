# 13 · Proveedores intercambiables

Objetivo: que **cada aspecto** del pipeline (texto, voz, transcripción, imágenes, video, música, almacenamiento, publicación, avisos) pueda usar **cualquier proveedor, local o en la nube**, sin tocar las etapas. Ver [ADR-011](11-decisiones.md).

## Veredicto

**Es viable y conviene hacerlo desde la Fase 1**, porque cuesta poco al principio y mucho después. Hay que tener claras cuatro cosas:

1. **No todos los proveedores hacen lo mismo.** La interfaz unifica la entrada y la salida, no las capacidades. Por ejemplo, Gemini TTS acepta un prompt de estilo y Kokoro no. Cada proveedor **declara** qué sabe hacer, y la UI y el pipeline se adaptan.
2. **"Local" está limitado por los 4 GB de VRAM.** El modo 100 % local ($0) es posible, pero más lento y de menor calidad. Sirve como **plan B sin internet**, no como modo principal (ver la tabla).
3. **La publicación no es "cualquier proveedor" de verdad.** La interfaz es común, pero cada plataforma (YouTube, TikTok, Instagram) es una integración propia con su propia auditoría.
4. **Cada adaptador es código que hay que mantener.** Por eso se priorizan los **adaptadores genéricos**: uno solo cubre decenas de proveedores.

## Aspectos (capacidades) y opciones

| Aspecto | Interfaz | Nube | Local | ¿Local viable en una 3050 de 4 GB? |
|---|---|---|---|---|
| Texto (ideas, guiones, metadatos) | `TextProvider` | Gemini, OpenAI, Claude, DeepSeek, OpenRouter, Groq | Ollama, LM Studio, llama.cpp server | 🟡 Modelos de 3–4 B cuantizados: más lentos, peor español y JSON menos fiable |
| Embeddings (temas repetidos) | `EmbeddingProvider` | Gemini, OpenAI | Ollama (`bge-m3`, `nomic-embed`) | ✅ Incluso en CPU |
| Voz | `TtsProvider` | Gemini TTS, Google Chirp 3 HD, ElevenLabs, OpenAI TTS, Azure | Kokoro (CPU), Piper (CPU), Chatterbox (GPU) | ✅ Kokoro y Piper en CPU · 🟡 Chatterbox justo |
| Transcripción con tiempos por palabra | `TranscriptionProvider` | Whisper por API (OpenAI, Groq), Deepgram, ElevenLabs Scribe | whisper.cpp CUDA o CPU | ✅ Es la opción por defecto |
| Medios de stock | `StockMediaProvider` | Pexels, Pixabay | carpeta propia con etiquetas | ✅ |
| Imágenes IA | `ImageProvider` | Gemini / Imagen, OpenAI, FLUX vía fal o Replicate | ComfyUI (SD 1.5, SDXL Lightning) | 🟡 SD 1.5 sí; SDXL lento; FLUX no entra |
| Video IA | `VideoProvider` | Veo, Kling, Runway, Luma (vía API o fal) | — | ❌ No entra en 4 GB · se usa el proveedor **manual** |
| Música | `MusicProvider` | Lyria (Google), otros generadores con licencia comercial | carpeta con pistas libres de derechos | ✅ Carpeta |
| Render (codificador) | `encoder` en la configuración | — | NVENC, x264 (CPU), Intel QSV, AMD AMF | ✅ El motor sigue siendo FFmpeg; se cambia solo el codificador |
| Almacenamiento | `StorageProvider` | Google Drive, OneDrive, Dropbox, S3, R2, B2 | carpeta local o NAS | ✅ |
| Publicación | `PublishTarget` | YouTube, TikTok, Instagram Reels, Facebook | exportación manual con metadatos | — |
| Avisos | `Notifier` | Telegram, Discord, webhook (n8n) | notificación de Windows | ✅ |

La **Biblia** es una fuente de datos, no un proveedor de IA. `BibleSource` puede cambiar de traducción (siempre de dominio público o con una licencia que el usuario tenga), pero **nunca la genera una IA** (ADR-009).

## Adaptadores genéricos: uno cubre muchos

| Adaptador | Qué cubre |
|---|---|
| **OpenAI-compatible** | Texto, embeddings, voz, transcripción e imágenes en OpenAI, **Ollama, LM Studio, llama.cpp, vLLM**, OpenRouter, Groq, DeepSeek, Together, Kokoro-FastAPI, Speaches… Solo cambian `baseUrl`, `model` y la clave. |
| **Gemini** (nativo) | Texto, TTS, imágenes, Veo, embeddings. Es nativo porque TTS e imágenes no son compatibles con OpenAI. |
| **Anthropic** (nativo) | Texto con Claude |
| **fal / Replicate** | Cientos de modelos de imagen y video con una sola integración |
| **ComfyUI** | Cualquier modelo local de imagen, a partir de un workflow JSON guardado |
| **Sidecar Hefesto** | Contrato HTTP mínimo (`/health`, `/capabilities`, `/run`). Permite envolver **cualquier modelo en Python** (Chatterbox, etc.) sin meter Python en el núcleo. |
| **Comando** | Un ejecutable con una plantilla de argumentos (Piper, `whisper.exe`, `gemini -p`). La salida se lee de un archivo o de stdout. |
| **Manual** | Crea una tarea para el usuario ("generá el hook en Flow y soltalo acá") y espera el archivo en una carpeta. Cubre todo lo que no tiene API: Veo en Flow, Suno, grabar tu propia voz. |

Con estos ocho adaptadores, sumar un proveedor nuevo casi siempre es **configuración, no código**.

## Cómo encaja en la arquitectura

### 1. Manifiesto del proveedor
Cada adaptador declara:

```ts
interface ProviderManifest {
  adapter: string;                    // 'openai-compatible', 'gemini', 'sidecar', 'manual'...
  capabilities: Capability[];         // 'text' | 'tts' | 'transcribe' | 'image' | ...
  kind: 'cloud' | 'local' | 'manual';
  resources: { lane: 'gpu' | 'net' | 'cpu'; vramMb?: number };
  license: { name: string; commercial: boolean; url?: string };
  secrets: string[];                  // nombres de claves en la bóveda, nunca valores
  features: {                         // qué sabe hacer, para que la UI se adapte
    jsonSchema?: boolean; stylePrompt?: boolean; voiceCloning?: boolean;
    wordTimestamps?: boolean; languages?: string[]; maxInputChars?: number;
    aspectRatios?: string[];
  };
  pricing?: { unit: 'char' | 'token' | 'image' | 'second' | 'request'; usdPerUnit: number }; // editable
}
```

### 2. Instancias configurables (`ProviderConfig`)
Un mismo adaptador puede tener varias instancias: "Ollama · qwen3 4B" y "OpenRouter · Claude" usan el mismo adaptador OpenAI-compatible con otro `baseUrl` y otro `model`. La configuración va en la base de datos. La **clave** la pega el usuario en Ajustes y se guarda cifrada con Windows DPAPI (ADR-012); la base guarda solo su nombre (`secretRef`).

### 3. Asignación por canal y por rol
Cada canal elige una instancia **por aspecto**, heredando los valores globales, con **roles** dentro de texto: `ideas` (barato), `script` (el mejor), `metadata`, `keywords`. Cada asignación tiene su lista de **respaldos** (fallback).

### 4. La cola decide el carril según el proveedor
El carril sale del manifiesto, no del tipo de etapa. Un TTS en la nube va a `net`; Chatterbox local va a `gpu` y respeta la regla de **una tarea de GPU a la vez**. Los LLM locales en Ollama se descargan de la VRAM al terminar (`keep_alive: 0`) para dejar lugar a Whisper y NVENC.

### 5. Salidas normalizadas y validadas
Las etapas solo ven formatos de Hefesto:
- audio en WAV de 48 kHz, convertido con FFmpeg;
- `words.json` con el mismo esquema, venga de whisper.cpp o de Deepgram;
- guiones validados con **zod**, con un reintento de "reparación" si el JSON viene mal (clave con modelos locales chicos).

El QA es el mismo para todos los proveedores.

### 6. Idempotencia, costos y licencias
- El `inputHash` incluye la instancia, el modelo, la versión del adaptador y los parámetros. Cambiar de proveedor rehace solo esa etapa y las siguientes.
- **Siempre** se registra un `CostEntry`, con $0 si es local, junto con la duración. Así la pantalla Costos compara "barato pero lento" contra "rápido pero pago".
- **Licencias aplicadas, no solo documentadas.** Si el canal monetiza, los proveedores con `commercial: false` aparecen deshabilitados, y la cola además rechaza el trabajo (ADR-008).

### 7. Respaldos con criterio
| Aspecto | Respaldo automático |
|---|---|
| Texto, embeddings, stock, imágenes, transcripción | ✅ Sí: si falla o hay límite de uso, pasa al siguiente |
| **Voz** | ⚠️ Solo del **video completo** y **apagado por defecto**. Cambiar de voz a mitad de video, o sin avisar, rompe la identidad del canal |
| Publicación | ❌ No: se reintenta en la misma plataforma |

### 8. Probar y garantizar
- Botón **"Probar"** por proveedor en Ajustes: conexión, lista de modelos y una muestra (por ejemplo, 5 s de voz).
- **Pruebas de contrato** compartidas: cada adaptador pasa la misma batería de pruebas.
- Un proveedor **`fake`** para desarrollar y probar sin red ni costo.

## Perfiles listos

| Perfil | Combinación | Costo por short | Para qué |
|---|---|---|---|
| **Sin internet** | Ollama + Kokoro + whisper.cpp + carpeta de stock + NVENC + carpeta local | **$0** | Plan B y pruebas; calidad menor |
| **Mínimo** | Gemini gratis + Gemini TTS + Pexels | ~$0.02 | Empezar |
| **Equilibrado** ⭐ | Gemini Flash + Gemini TTS + imágenes IA | ~$0.20–0.30 | Por defecto |
| **Premium** | Mejor LLM + ElevenLabs + imágenes IA + Veo | $1+ | Canales que lo justifiquen |

## Qué se construye y cuándo

| Fase | Proveedores |
|---|---|
| 1 | Contrato, manifiesto y registro · `fake` · **OpenAI-compatible** (sirve para Ollama) · Gemini (texto y TTS) · Pexels · whisper.cpp (comando) · almacenamiento en carpeta local |
| 2 | Pantalla de proveedores en Ajustes con "Probar" · asignación por canal y rol · respaldos · **manual** |
| 3 | Google Drive como `StorageProvider` |
| 4 | Imágenes (Gemini, fal) · música · sidecar Hefesto · Kokoro |
| 5 | `PublishTarget`: YouTube, TikTok |
| 6 | `Notifier`: Windows, Telegram, webhook |
| Según demanda | ElevenLabs, Anthropic, ComfyUI, OneDrive, S3, Instagram… |
