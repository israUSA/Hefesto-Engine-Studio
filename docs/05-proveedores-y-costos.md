# 05 · Proveedores y costos

> ⚠️ Los precios son **aproximados** (sept. 2026) y cambian seguido. Hay que verificarlos al implementar cada proveedor. Los nombres y versiones de los modelos van en la configuración, nunca fijos en el código.

## Gemini: qué da la suscripción y qué no

La suscripción **Google AI Pro** (Gemini Pro) **no incluye créditos de API**. Incluye:
- la app de Gemini, Flow y Veo con cuota limitada (uso manual)
- **2 TB de Google Drive**, ideal para el archivo de Hefesto Engine Studio

Para automatizar:
1. **Gemini API** (AI Studio): nivel gratuito con límites de uso. En el nivel gratis, Google puede usar los datos para mejorar sus productos. El nivel de pago cuesta fracciones de centavo por guion.
2. **Gemini CLI** (`gemini -p`) con sesión de la cuenta Pro: posible alternativa para guiones. Hay que revisar límites y términos antes de apoyarse en él.
3. **Veo desde Flow, a mano**: clips premium para hooks.

## Texto (ideas y guiones)
| Proveedor | Uso | Costo aprox. |
|---|---|---|
| Gemini Flash (API) | ideas, guiones en volumen, metadatos | < $0.005 / guion |
| Gemini Pro (API) | guiones importantes o series | ~$0.01–0.03 / guion |
| Embeddings de Gemini | detectar temas repetidos | despreciable |
| Ollama / LM Studio (local, 3–4 B cuantizado) | plan B sin internet, ideas | $0 · más lento, peor JSON y español |
| OpenAI, Claude, DeepSeek, OpenRouter | alternativas en la nube | según el modelo |

Cualquier aspecto puede usar otro proveedor, local o en la nube: ver [13 · Proveedores intercambiables](13-proveedores-intercambiables.md).

## Voz (TTS)

Con 4 GB de VRAM, **la voz va a la nube por defecto** (ver [ADR-005](11-decisiones.md)). Un short de 60 s tiene ~150 palabras, unos 900 caracteres.

| Proveedor | Calidad | Costo por short de 60 s | Licencia | Notas |
|---|---|---|---|---|
| **Gemini TTS** ⭐ | Muy buena | ~$0.01–0.02 | Uso comercial OK | Estilo controlable por prompt, buen español. **Opción por defecto** |
| Google Cloud TTS (Chirp 3 HD) | Muy buena | ~$0.03 | Uso comercial OK | Voces estables y consistentes |
| ElevenLabs | Excelente | ~$0.15–0.25 | Según plan | Solo para canales que lo justifiquen |
| Chatterbox Multilingual (local) | Muy buena | $0 | MIT | Necesita más VRAM; **futuro sidecar** |
| Kokoro-82M (local, CPU) | Buena | $0 | Apache 2.0 | Pocas voces en español; plan B sin internet |
| ~~XTTS v2~~ | | | **No comercial** | ❌ No usar en canales monetizados |
| ~~F5-TTS, Fish Speech (pesos)~~ | | | **No comercial** | ❌ |

## Imágenes
| Proveedor | Costo aprox. | Notas |
|---|---|---|
| **Pexels / Pixabay** | $0 | Fotos y videos de stock con API gratuita; revisar sus condiciones de atribución |
| Gemini image / Imagen (rápido) | ~$0.02–0.04 / imagen | Estilo consistente con `basePrompt` |
| FLUX / SDXL local | $0 | ❌ No viable en 4 GB con buena calidad |

## Video IA
| Proveedor | Costo aprox. | Uso |
|---|---|---|
| Veo en Flow (suscripción) | incluido, con cuota | Hooks premium, generados **a mano** e importados |
| Veo por API | decenas de centavos por segundo | Solo casos puntuales, no en volumen |

## Local (costo $0)
| Herramienta | Uso |
|---|---|
| whisper.cpp + CUDA (`large-v3-turbo`, cuantizado) | Transcripción con timestamps por palabra |
| FFmpeg (NVENC) | Render, audio, miniaturas |

## Costo por short (60 s)

| Nivel | Combinación | Costo |
|---|---|---|
| **Mínimo** | Gemini gratis + Gemini TTS + stock | **~$0.02** |
| **Equilibrado** ⭐ | Gemini Flash + Gemini TTS + 5 imágenes IA | **~$0.20–0.30** |
| **Premium** | ElevenLabs + imágenes IA + hook con Veo | **$1+** |

Ejemplo: 3 canales × 1 short al día ≈ 90 shorts al mes ≈ **$2 (mínimo)** o **$20–27 (equilibrado)**.

## Registro de costos
Cada llamada con costo crea un `CostEntry`. El panel muestra el gasto del mes por proveedor y canal, el costo medio por video y una **alerta de presupuesto** mensual configurable.
