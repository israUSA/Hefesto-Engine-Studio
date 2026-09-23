# 01 · Visión

## El problema

Producir contenido para redes de forma constante es una cadena de pasos sueltos:

```
idea → guion → voz → revisar → montar video → subtitular → música → render → organizar → subir → repetir
```

Cada paso vive en una herramienta distinta y exige estar pendiente archivo por archivo. Con varios canales (distintas cuentas, idiomas y nichos), esto se vuelve inmanejable.

## La referencia: ZAP Estudio

Un panel local (Python + XTTS + Whisper + FFmpeg + FastAPI + SQLite + CUDA + Drive API) que convierte filas de un CSV en videos. Lo que hace bien y **adoptamos**:

- **Idempotencia**: detecta lo que ya existe, en disco o en Drive, y no lo regenera.
- **Cola única de GPU** con pausar, saltar, detener y reintentar solo lo fallido.
- **Estimación de tiempo** basada en duraciones históricas reales.
- **Parámetros de voz por proyecto** aplicados encima de la configuración base.
- **Whisper como QA**: verificar que el audio dice lo que dice el texto.
- **Vista Drive**: una tabla de "dónde está cada cosa" (disco, Drive, faltantes).

Lo que **le falta** y es el foco de Hefesto Engine Studio:

| ZAP Estudio | Hefesto Engine Studio |
|---|---|
| "Proyectos" = idioma × formato × nicho | **Canales** reales (plataforma, handle, nicho, brand kit, calendario) |
| El contenido llega escrito en un CSV | **Generación** de ideas y guiones con Gemini, sin repetir temas |
| Sin paso de aprobación | **Kanban** Idea → Guion → Aprobado → Producido → Revisado → Publicado |
| Una sola plantilla visual por proyecto | **Plantillas y variación** (hooks, escenas, estructuras) para evitar contenido repetitivo |
| No publica | **Metadatos, calendario** y subida por API (por fases) |
| Sin costos | **Costo por video, canal y proveedor** |
| Voz XTTS (licencia no comercial) | **Proveedores intercambiables** con licencias aptas para monetizar |
| App web local | **App de escritorio** (Electron) |

## Principios

1. **Supervisar, no operar.** El usuario decide qué se produce y aprueba; la máquina hace el resto.
2. **Lo más barato que mantenga la calidad.** Local cuando el hardware alcanza, nube cuando es más barata que comprar hardware.
3. **Nunca pagar dos veces por lo mismo.** Idempotencia y reutilización de recursos.
4. **Cada canal tiene identidad propia.** Voz, estilo, tono y calendario por canal.
5. **Confiabilidad antes que volumen.** QA estricto, y en el nicho cristiano, texto bíblico siempre verificado.

## Primer caso de uso

Canales de **contenido cristiano en español** (oraciones, versículos, devocionales, historias bíblicas) en TikTok y YouTube Shorts. Ver [08 · Nicho cristiano](08-nicho-cristiano.md).
