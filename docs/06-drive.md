# 06 · Google Drive

Drive es el **archivo completo**; el disco local es un espacio de trabajo que se puede liberar. La cuenta Google AI Pro trae **2 TB**.

## Autenticación
- Proyecto en Google Cloud con **Drive API** habilitada.
- OAuth de tipo **"app de escritorio"**; el token de refresco se guarda cifrado localmente.
- Scope mínimo: `drive.file` (solo archivos creados por la app). Evitar `drive` completo.
- La pantalla de consentimiento puede quedarse en modo "prueba" para uso personal. En ese modo los tokens de refresco caducan a los 7 días; para evitarlo, publicar la app (sin verificar, uso propio) o reautenticar.

## Estructura de carpetas

```
Hefesto Engine Studio/
└─ <Canal>/                       # por ejemplo "Fe Diaria (TikTok)"
   ├─ renders/<YYYY-MM>/<id>-<slug>.mp4
   ├─ thumbs/<YYYY-MM>/<id>-<slug>.jpg
   ├─ audio/<YYYY-MM>/<id>-<slug>.wav
   └─ scripts/<YYYY-MM>/<id>-<slug>.json
```

## Índice e idempotencia
- Cada subida registra un `DriveFile` (`driveId`, `md5`, `folderId`).
- **Hecho** = existe en disco **o** en Drive con hash coincidente. Nunca se regenera algo que ya está en Drive.
- **Sincronizar**: lista los archivos de las carpetas de la app, reconcilia el índice y detecta faltantes o huérfanos.

## Vista en el panel (como ZAP, mejorada)
- Tarjetas: audios, videos y portadas en Drive; última sincronización; **en disco ahora** y **espacio liberable**.
- Tabla "Dónde está cada cosa" por canal: en disco / en Drive / faltan, por tipo de recurso.
- Acciones:
  - **Subir** (manual o automático tras el QA, configurable por canal)
  - **Liberar espacio**: borra del disco lo que ya está verificado en Drive
  - **Traer de vuelta**: descarga desde Drive para re-editar o publicar

## Límites
- Cuota de la Drive API: amplia para este uso. Subidas reanudables para archivos > 5 MB.
- La subida es por red, así que va en la **lane `net`** de la cola, sin bloquear la GPU.
