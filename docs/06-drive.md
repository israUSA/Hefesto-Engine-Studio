# 06 · Google Drive

Drive es el **archivo completo**; el disco local es un espacio de trabajo que se puede liberar. La cuenta Google AI Pro trae **2 TB**.

El archivo pasa por la capacidad `StorageProvider` (ver [13](13-proveedores-intercambiables.md)), así que Drive no es la única opción:

| Adaptador | Para qué |
|---|---|
| `google-drive` | Google Drive por su API REST (sin SDK), scope `drive.file` |
| `local-folder` | Un disco externo, un NAS o la carpeta de "Google Drive para escritorio". Sin cuentas ni claves |

Una instalación nueva **no archiva**: el usuario elige el destino en la vista **Drive** (o conecta Google en Ajustes, y Drive queda elegido solo). `setup --offline` archiva en `HEFESTO_HOME/archivo-local`.

## Autenticación
- Proyecto en Google Cloud con **Drive API** habilitada.
- OAuth de tipo **"app de escritorio"**. El usuario pega el ID y el secreto del cliente en **Ajustes → Cuentas y OAuth** y toca **Conectar con Google**.
- Flujo: el navegador abre la pantalla de consentimiento y vuelve a la API por loopback (`http://127.0.0.1:<puerto>/api/storage/google/callback`) con PKCE (S256) y un `state` de un solo uso que vence a los 10 minutos. Los clientes de escritorio aceptan cualquier puerto de loopback sin registrarlo.
- Scope mínimo: `drive.file` (solo archivos creados por la app). Nunca `drive` completo.
- En la bóveda cifrada (ADR-012): `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` y `GOOGLE_DRIVE_REFRESH_TOKEN`. El correo de la cuenta se guarda en `settings` solo para mostrarlo.
- **Desconectar** revoca el token en Google (si hay red) y lo borra de la bóveda. Lo ya archivado sigue en Drive.
- La pantalla de consentimiento puede quedarse en modo "prueba" para uso personal. En ese modo los tokens de refresco caducan a los 7 días; para evitarlo, publicar la app (sin verificar, uso propio) o reconectar. Un token vencido o revocado da un error claro ("reconectá la cuenta") y no se reintenta.

## Estructura de carpetas

```
Hefesto Engine Studio/
└─ <Canal> (<Plataforma>)/        # por ejemplo "Devocional (TikTok)"
   ├─ renders/<YYYY-MM>/<id>-<slug>.mp4
   ├─ thumbs/<YYYY-MM>/<id>-<slug>.jpg
   ├─ audio/<YYYY-MM>/<id>-<slug>.wav
   └─ scripts/<YYYY-MM>/<id>-<slug>.json
```

`<id>` son los primeros 8 caracteres de la producción y `<slug>` sale del título. El mes es el de creación de la producción. Si se vuelve a subir, se reemplaza el mismo archivo (en Drive conserva su id).

## Subida: etapa `archive`
Es la **última etapa del pipeline** (ver [04](04-pipeline.md)), en la lane que declare el proveedor: `net` para Drive, `cpu` para una carpeta.

- **Automática** solo si el QA pasó y el canal tiene activado "Subir cada video al archivo" (Canal → Identidad, `Channel.autoArchive`, activo por defecto). Si no hay almacenamiento elegido, la etapa se salta.
- **Manual**: "Subir al archivo" en la biblioteca o "Subir pendientes" en la vista Drive. Encola `archive` forzada, aunque el QA haya fallado.
- Drive: subida **reanudable** en trozos de 8 MiB; tras un corte de red pregunta a Drive el último byte recibido y sigue desde ahí (hasta 5 veces por archivo). Después compara el `md5Checksum` de Drive con el MD5 local.
- Cada subida registra una fila en `remote_files` y un `CostEntry` de $0.

## Índice e idempotencia
- `remote_files` (el `DriveFile` de [03](03-modelo-de-datos.md)): una fila por producción y tipo, con `remoteId`, `remotePath`, `md5`, tamaño y `present`.
- **Hecho** = existe en disco **o** en el archivo con checksum verificado. Una etapa cuya salida está archivada no se regenera; si una etapa posterior necesita el archivo (por ejemplo, re-renderizar necesita la voz), se **trae de vuelta** del archivo, no se vuelve a pagar el TTS.
- La etapa `archive` no vuelve a subir lo que ya está con el mismo MD5; sí sube lo que cambió o lo que "Sincronizar" encontró faltante.
- **Sincronizar**: lista los archivos del proveedor, marca `present = false` lo que ya no está y cuenta los archivos sin registrar.

## Liberar espacio y traer de vuelta
- **Liberar espacio** borra del disco `render.mp4`, `voice.wav` y `voice.raw.wav` solo si el render y la voz están archivados y su **MD5 local coincide** con el archivado. Si no coincide (por ejemplo, se re-renderizó sin volver a subir), no borra nada y lo avisa. La portada, el guion, las escenas y los subtítulos quedan en el disco.
- La producción queda con `freed_at`: la biblioteca muestra la portada y "El video está en el archivo · Traer de vuelta".
- **Traer de vuelta** descarga los archivos liberados a su carpeta y limpia `freed_at`.
- Borrar una producción no borra su copia archivada.

## Vista en el panel (como ZAP, mejorada)
- Métricas: bytes en el archivo, videos y audio en el disco y **espacio liberable**; barra por tipo (videos, audio, portadas, guiones).
- Tabla "Dónde está cada video" por canal: disco + archivo / solo archivo / solo disco / faltan, y liberable.
- Panel lateral: **Liberar espacio**, **Subir pendientes**, "Subiendo ahora" (trabajos `archive` de la cola, en vivo), aviso de reconexión y la estructura de carpetas del último video.
- Sin destino elegido, la vista ofrece Google Drive o una carpeta.

## API
Ver `libs/shared/types/src/lib/api.ts` (sección Storage): `GET /api/storage`, `PUT /api/storage/target`, `POST /api/storage/sync`, `/upload`, `/free`, `/productions/:id/restore` y las rutas de la cuenta de Google en `/api/storage/google`.

## Límites
- Cuota de la Drive API: amplia para este uso. La cuota de espacio de la cuenta todavía no se muestra.
- La subida es por red, así que va en la **lane `net`** de la cola, sin bloquear la GPU.
- Pendiente: probar con una cuenta real (todo lo de Drive está probado con un Drive simulado en las pruebas).
