# 07 · Publicación

La publicación automática tiene **barreras de las plataformas**, por eso va por fases.

## Estrategia por fases
1. **Exportar** (desde la fase 1): el video, la miniatura y un panel con título, descripción y hashtags listos para copiar. Se sube a mano.
2. **Semi-automático**: subida por API como **borrador o privado** y publicación final a mano en la app.
3. **Automático** (cuando las auditorías lo permitan): publicación programada según `ScheduleSlot`.

## YouTube (Data API v3)
- Cuota por defecto: 10 000 unidades al día por proyecto. La subida (`videos.insert`) consume una parte grande (históricamente 1600 unidades), lo que da **pocas subidas al día**. *Verificar los valores actuales.*
- ⚠️ Los proyectos de API **sin auditar suben los videos como privados**. Para publicar públicamente por API hay que pasar la auditoría de cumplimiento de Google.
- Shorts: vertical, hasta 3 minutos.
- Hay que marcar el **contenido alterado o sintético** cuando es realista.

## TikTok (Content Posting API)
- Requiere registrar una app y pasar revisión.
- ⚠️ Los clientes **sin auditar** solo pueden publicar como **privado** (visible solo para el autor).
- Hay un modo que envía el video a la **bandeja o borradores** de la cuenta para terminar de publicarlo en la app. Encaja bien con la fase 2. *Verificar los scopes y requisitos actuales.*
- Etiqueta obligatoria de **contenido generado por IA** cuando corresponde.

## Políticas que afectan el diseño
- **YouTube: contenido masivo y repetitivo** no monetizable. Hefesto debe **variar** hooks, estructuras, escenas y plantillas, y no clonar el mismo video cambiando dos palabras.
- **Varias cuentas**: está permitido, pero publicar en masa y con patrones idénticos puede activar filtros antispam. El calendario reparte las publicaciones con un ritmo natural.
- **Música**: solo bibliotecas libres de derechos, registrando la licencia de cada pista.

## Metadatos por plataforma
| Campo | TikTok | YouTube Shorts |
|---|---|---|
| Título o caption | caption con hook y hashtags | título ≤ 100 caracteres |
| Descripción | incluida en el caption | descripción + hashtags (`#Shorts` opcional) |
| Hashtags | 3–5 relevantes | 3–5 |
| Etiqueta IA | sí, cuando corresponde | "contenido alterado" cuando corresponde |
