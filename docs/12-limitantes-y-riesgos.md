# 12 · Limitantes y riesgos

| # | Riesgo | Impacto | Mitigación |
|---|---|---|---|
| 1 | **4 GB de VRAM**: Whisper + NVENC a la vez, u otros programas usando la GPU | Errores por falta de memoria (OOM), jobs fallidos | Lane GPU con concurrencia 1, modelo de Whisper cuantizado, reintento con modelo más chico, aviso si la VRAM libre es baja |
| 2 | **Gemini Pro ≠ API**: la suscripción no da créditos de API | Costos inesperados o límites del nivel gratis | Nivel gratis para empezar, registro de costos y alerta de presupuesto |
| 3 | **Límites de uso** del nivel gratuito de Gemini | Tandas grandes frenadas | Lane de red con backoff, reparto de la tanda en el tiempo, pasar a pago si hace falta |
| 4 | **Publicación por API** restringida a privado sin auditoría (YouTube y TikTok) | No hay publicación 100 % automática al inicio | Publicación por fases (ADR-010), exportación con metadatos |
| 5 | **Contenido masivo y repetitivo** (YouTube) | Canal no monetizable | Variación de hooks, estructuras y plantillas; revisión humana en el kanban |
| 6 | **Etiquetado de IA** no aplicado | Penalizaciones o retirada del contenido | `Channel.aiLabel` y check en la publicación |
| 7 | **Versículos incorrectos** | Pérdida de credibilidad | ADR-009 + QA de versículos exactos |
| 8 | **Copyright** de traducciones bíblicas y música | Reclamos o retiradas | RV1909 por defecto; música solo libre de derechos con la licencia registrada |
| 9 | **Cambios de precio o modelos** de los proveedores | Costos o calidad variables | Capa de proveedores, modelos en la configuración, precios en una tabla editable |
| 10 | **Tokens OAuth** que caducan (app en modo prueba) | Drive deja de sincronizar | Aviso en el panel y reautenticación en un clic |
| 11 | **Filtros antispam** de las plataformas con varias cuentas | Alcance reducido o bloqueos | Publicación con ritmo natural, sin automatizar interacciones |
| 12 | **Tamaño del instalador** de Electron (binarios CUDA) | Descarga pesada | Descargar el modelo de Whisper en el primer arranque |
| 13 | **Curva de aprendizaje** de Angular y Nest (por confirmar) | Fases 1–2 más lentas | Ajustar el roadmap y empezar por el pipeline MVP |
| 14 | **Espacio en disco** con muchos renders | Disco lleno | Liberar espacio de lo verificado en Drive, alerta de disco |
