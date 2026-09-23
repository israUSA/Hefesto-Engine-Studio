# 11 · Registro de decisiones (ADR)

Formato: contexto → decisión → consecuencias. Las decisiones se reemplazan con un ADR nuevo, no se editan.

---

### ADR-001 · Canales como entidad principal
**Contexto:** ZAP organiza por "proyectos" (idioma × formato × nicho) y no modela cuentas reales.
**Decisión:** el `Channel` (plataforma, handle, nicho, identidad, calendario, carpeta de Drive) es la raíz del modelo.
**Consecuencias:** todo (guiones, producciones, costos, métricas) se filtra por canal. Un guion puede producirse en varios canales.

### ADR-002 · Angular para la UI (no Astro)
**Contexto:** la UI es un panel con estado en vivo, formularios complejos y tiempo real.
**Decisión:** Angular. Astro está pensado para sitios de contenido y obligaría a usar islas de otro framework.
**Consecuencias:** signals, DI y routing de Angular; design system propio en `libs/web/ui`.

### ADR-003 · NestJS para el backend
**Contexto:** se evaluó FastAPI (Python) como en ZAP.
**Decisión:** NestJS. Sus módulos encajan con el dominio y el stack queda 100% TypeScript con tipos compartidos.
**Consecuencias:** posible solo porque no se necesita ML en Python (ver ADR-005).

### ADR-004 · Electron, empaquetado al final
**Contexto:** se quiere una app de escritorio.
**Decisión:** Electron, con la API de Nest como proceso hijo. Se empaqueta en la última fase; mientras tanto corre como web local.
**Consecuencias:** instalador de cientos de MB por los binarios CUDA; el modelo de Whisper se descarga aparte.

### ADR-005 · Sin Python: voz e imágenes en la nube, Whisper y FFmpeg como binarios
**Contexto:** GPU RTX 3050 de 4 GB. El TTS local de calidad (Chatterbox, XTTS) queda justo o no entra; la generación local de imágenes no es viable.
**Decisión:** voz con Gemini TTS (~$0.01–0.02 por short), imágenes con stock o Gemini. Local solo `whisper.cpp` (CUDA) y `ffmpeg` (NVENC) como subprocesos.
**Consecuencias:** costo variable bajo y controlado. Si se mejora la GPU, se agrega un sidecar Python como otro `TtsProvider`.

### ADR-006 · Cola propia en SQLite (sin Redis/BullMQ)
**Contexto:** Redis complica Windows y el empaquetado en Electron; la GPU procesa de a una tarea.
**Decisión:** tabla `jobs` en SQLite con workers por lane (GPU = 1, red = 2–4, CPU = 1–2).
**Consecuencias:** cero infraestructura extra; suficiente para un solo usuario local.

### ADR-007 · Sin n8n en el núcleo
**Contexto:** se evaluó n8n para orquestar.
**Decisión:** la orquestación vive dentro de Hefesto. Se exponen webhooks de salida en la fase 6 para integraciones periféricas.
**Consecuencias:** menos piezas móviles; n8n sigue siendo opcional.

### ADR-008 · Nada de modelos con licencia no comercial
**Contexto:** los canales pueden monetizar. XTTS v2 (CPML) y los pesos de F5-TTS y Fish Speech son no comerciales.
**Decisión:** solo proveedores o modelos con uso comercial permitido.

### ADR-009 · La IA no escribe texto bíblico
**Contexto:** los LLM alucinan o parafrasean versículos.
**Decisión:** Gemini elige referencias; el texto sale de una Biblia local (RV1909, dominio público) y el QA lo verifica.

### ADR-010 · Publicación por fases
**Contexto:** las APIs de YouTube y TikTok restringen a privado las apps sin auditar.
**Decisión:** exportar → semi-automático (borrador o privado) → automático tras las auditorías.
