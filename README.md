# Hefesto Engine Studio

> La forja de shorts: una línea de producción local para crear, organizar y publicar videos cortos (TikTok · YouTube Shorts) por canal, supervisada desde un solo panel.

Hefesto Engine Studio toma un **canal** (plataforma + temática + identidad), genera **ideas y guiones** con Gemini, los convierte en **voz, subtítulos, visuales y video final**, los guarda en **Google Drive** y los deja listos para publicar. Todo desde una app de escritorio, sin tocar la consola.

Nace inspirado en *ZAP Estudio* (panel TTS + video con cola, biblioteca y Drive), pero con los **canales como entidad principal**, generación de contenido, control de calidad más estricto, costos visibles y un diseño propio.

---

## Qué hace

- **Canales**: cada cuenta de TikTok o YouTube con su nicho, voz, estilo visual, brand kit, carpeta de Drive y calendario.
- **Ideas → Guiones**: Gemini propone temas sin repetir y escribe guiones con hook, cuerpo y CTA, más título, descripción y hashtags.
- **Aprobación**: un tablero kanban para revisar guiones antes de gastar GPU o API.
- **Producción en cola**: voz (TTS), subtítulos palabra por palabra, escenas, música con ducking, watermark y render 9:16 o 16:9.
- **QA automático**: el audio coincide con el guion, los versículos son exactos, el volumen se normaliza, se respetan la duración y los márgenes seguros.
- **Idempotencia**: nada se regenera si ya existe, en disco o en Drive.
- **Biblioteca**: cada video, audio y portada generados, filtrados por canal.
- **Drive**: archivo completo en Google Drive con un índice local.
- **Publicación**: exportación con metadatos, calendario y, más adelante, subida por API.
- **Costos**: gasto por video, por canal y por proveedor.

## Stack

| Capa | Tecnología |
|---|---|
| Monorepo | Nx |
| UI | Angular |
| API y cola | NestJS + SQLite |
| Escritorio | Electron |
| IA (texto, voz, imagen) | Gemini API, detrás de una capa de proveedores intercambiables |
| Subtítulos | whisper.cpp (CUDA, local) |
| Render | FFmpeg (NVENC, libass) |
| Archivo | Google Drive API |

Todo en **TypeScript**. Los procesos pesados locales son binarios (`ffmpeg`, `whisper.cpp`) que se llaman como subprocesos.

## Documentación

| Doc | Contenido |
|---|---|
| [01 · Visión](docs/01-vision.md) | Problema, referencia (ZAP), qué hacemos distinto |
| [02 · Arquitectura](docs/02-arquitectura.md) | Stack, estructura del monorepo, módulos, cola, Electron |
| [03 · Modelo de datos](docs/03-modelo-de-datos.md) | Entidades, estados y relaciones |
| [04 · Pipeline](docs/04-pipeline.md) | Etapas de producción, idempotencia y QA |
| [05 · Proveedores y costos](docs/05-proveedores-y-costos.md) | Voz, imagen, video, texto: calidad, precio y licencias |
| [06 · Google Drive](docs/06-drive.md) | Estructura de carpetas, índice y sincronización |
| [07 · Publicación](docs/07-publicacion.md) | YouTube, TikTok, límites de API y políticas |
| [08 · Nicho cristiano](docs/08-nicho-cristiano.md) | Biblia local, derechos de traducciones, formatos |
| [09 · Diseño UI](docs/09-diseno-ui.md) | Pantallas, identidad visual, flujo en pen.dev |
| [10 · Roadmap](docs/10-roadmap.md) | Fases, duración y checklists |
| [11 · Decisiones](docs/11-decisiones.md) | Registro de decisiones de arquitectura (ADR) |
| [12 · Limitantes y riesgos](docs/12-limitantes-y-riesgos.md) | Lo que puede salir mal y cómo mitigarlo |
| [13 · Proveedores intercambiables](docs/13-proveedores-intercambiables.md) | Cualquier proveedor, local o en la nube, en cada aspecto |

## Repositorio

[github.com/israUSA/Hefesto-Engine-Studio](https://github.com/israUSA/Hefesto-Engine-Studio)

```bash
git clone https://github.com/israUSA/Hefesto-Engine-Studio.git
```

## Hardware de referencia

- GPU: **NVIDIA RTX 3050 Laptop, 4 GB VRAM**. Alcanza para Whisper y NVENC; la voz y las imágenes IA van a la nube.
- SO: Windows 11.

## Cómo correrlo (Fase 1)

Requisitos: Node 22 o más nuevo y Windows 10/11.

```bash
npm install
npx ts-node --transpile-only --project tools/tsconfig.json tools/fetch-binaries.ts   # ffmpeg, whisper.cpp y modelo en bin/
npx nx run api:cli setup    # crea la base, el catálogo de proveedores y la RV1909 (sin canales)
npx nx run api:cli keys set GEMINI_API_KEY   # pide la clave oculta y la guarda cifrada
npx nx run api:cli keys set PEXELS_API_KEY
npx nx run api:cli keys     # qué claves faltan
npx nx run api:cli setup --demo   # opcional: canales de demostración desde las plantillas
npx nx run api:produce --channel demo-devocional --count 3
```

- La app instalada arranca **vacía** (sin canales): al primer inicio carga el catálogo de proveedores y la Biblia sola. Los canales se crean desde la app, en blanco o desde una plantilla de nicho.
- Sin claves: `npx nx run api:cli setup --offline` usa el proveedor `fake` para texto, voz, stock y transcripción (sirve para probar el render). Para volver a los proveedores reales: `setup --reset-bindings`.
- Retomar o rehacer: `--resume <productionId>` salta lo que no cambió; `--force` rehace todo.
- Los videos quedan en `HEFESTO_HOME/channels/<canal>/productions/<id>/` (`render.mp4`, `thumb.jpg`, `qa.json`…). Por defecto `HEFESTO_HOME` es `~/HefestoHome`.
- El codificador se detecta solo: NVENC (NVIDIA) → QSV (Intel) → AMF (AMD) → libx264. Se puede forzar con `HEFESTO_ENCODER`.
- Las claves se guardan cifradas con Windows DPAPI en `HEFESTO_HOME/secrets.json` (solo tu usuario de Windows puede leerlas). En la Fase 2 se cargan desde Ajustes → Proveedores. `.env` sigue funcionando como respaldo para desarrollo.
- Pruebas: `npx jest --config apps/api/jest.config.cts`.

## Estado

🟡 **Fase 1: pipeline MVP.** El pipeline corre de punta a punta; falta probarlo con claves reales. Ver [roadmap](docs/10-roadmap.md).
