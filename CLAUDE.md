# Hefesto Engine Studio: guía para agentes

App de escritorio local para producir shorts (TikTok / YouTube Shorts) por **canal**. Leé el [README](README.md) y [docs/](docs/) antes de cambiar la arquitectura.

## Stack

Nx monorepo · Angular (`apps/web`) · NestJS (`apps/api`) · Electron (`apps/desktop`) · SQLite · FFmpeg + whisper.cpp como subprocesos · Gemini API · Google Drive API. Todo TypeScript, sin Python (ver [ADR-005](docs/11-decisiones.md)).

## Convenciones

- **Idioma**: la UI y los docs, en español. El código (identificadores, commits, nombres de archivos de código), en inglés.
- **Tipos compartidos** en `libs/shared/types`. Un modelo se define una sola vez.
- **Proveedores**: todo servicio intercambiable (IA, stock, transcripción, almacenamiento, publicación, avisos), local o en la nube, pasa por la interfaz de su capacidad y declara un `ProviderManifest`. Nunca se llama a un SDK, binario o API directo desde una etapa del pipeline. Ver [13](docs/13-proveedores-intercambiables.md).
- **Cada llamada con costo** registra un `CostEntry`.
- **Etapas idempotentes**: cada etapa calcula un hash de sus entradas y se salta si la salida existe con el mismo hash.
- **Secretos**: el usuario los carga en la app (Ajustes → Proveedores; hoy `nx run api:cli keys set`) y se guardan cifrados con Windows DPAPI en `HEFESTO_HOME/secrets.json` (`SecretVault`, ADR-012). La base guarda solo el **nombre** (`secretRef`). `.env` es un respaldo para desarrollo. Nunca en el repo, en la base, en logs ni devueltos completos a la UI.

## Reglas que no se rompen

1. **La IA nunca escribe texto bíblico.** Gemini elige referencias; el texto sale siempre de la Biblia local (ver [08](docs/08-nicho-cristiano.md)).
2. **Una sola tarea de GPU a la vez** (Whisper y el render con NVENC comparten 4 GB de VRAM).
3. **No se publica nada sin pasar QA** y sin la etiqueta de contenido IA cuando corresponde.
4. **No usar modelos con licencia no comercial** (XTTS v2, pesos de F5-TTS o Fish Speech) para contenido que se monetiza.
