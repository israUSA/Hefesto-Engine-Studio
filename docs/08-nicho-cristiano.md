# 08 · Nicho cristiano (español)

Primer caso de uso de Hefesto Engine Studio: canales de contenido cristiano en español para TikTok y YouTube Shorts.

## Regla #1: la IA nunca escribe texto bíblico

Los modelos de lenguaje pueden **inventar, mezclar o parafrasear** versículos. En este nicho, un versículo mal citado destruye la credibilidad del canal.

**Flujo obligatorio:**
1. Gemini elige **referencias** (`Salmos 23:1`), nunca el texto.
2. El módulo `bible` busca el texto exacto en la **Biblia local**.
3. El guion inserta ese texto literal.
4. El QA verifica que cada referencia aparezca **literal** en el guion y en el audio (WER en ese tramo).

## Traducciones y derechos

| Traducción | Estado | Uso |
|---|---|---|
| **Reina-Valera 1909** | Dominio público | ✅ **Por defecto**. Se incluye en `data/bible/` |
| Reina-Valera 1960 | Con copyright (Sociedades Bíblicas Unidas) | ⚠️ Revisar sus condiciones de citación antes de usarla |
| NVI, NTV, DHH, LBLA | Con copyright | ⚠️ Revisar condiciones y límites de citación |

Cada canal define su `bibleTranslation`. Si se elige una traducción con copyright, hay que registrar la atribución que exija y respetar sus límites.

Fuente de la RV1909: conseguir un texto de dominio público en formato estructurado (JSON o CSV) de un proyecto open source, **verificar su integridad** (libros, capítulos y versículos completos) e importarlo a la tabla `BibleVerse` con índice FTS5.

## Formatos (plantillas de guion)

| Formato | Duración | Estructura |
|---|---|---|
| **Versículo del día** | 20–35 s | hook → versículo → reflexión breve → CTA |
| **Oración guiada** ("Oración para…") | 45–75 s | invitación → oración → Amén → CTA |
| **Historia bíblica en 60 s** | 50–70 s | gancho narrativo → historia → enseñanza; en serie por partes |
| **¿Sabías que…?** | 25–40 s | pregunta → dato → versículo de respaldo |
| **Devocional por fecha** | 30–60 s | ligado a Adviento, Cuaresma, Semana Santa, Año Nuevo... |
| **Palabra para tu situación** | 30–45 s | "Si estás pasando por ___" → versículo → aliento |

## Tono y reglas del canal (ejemplo de "biblia del canal")
- Cálido, esperanzador, respetuoso; segunda persona ("vos" o "tú", **definir por canal**).
- Sin promesas de milagros ni lenguaje manipulador ("comparte o…").
- Sin polémica denominacional, salvo que el canal lo defina (por ejemplo, católico o evangélico).
- CTA suave: "Guarda esta oración", "Escríbele 'Amén'".

## Estilo visual sugerido
- Paisajes luminosos, amaneceres, montañas, agua, luz entre nubes: funcionan bien con stock y con IA.
- Evitar generar con IA **rostros de Jesús o personajes bíblicos**: suelen verse artificiales y generan rechazo. Preferir paisajes, siluetas y simbología (cruz, luz, manos).
- Texto grande y legible; el versículo destacado en pantalla con la referencia.

## Voz
- Gemini TTS con un `stylePrompt` del tipo "voz cálida, pausada, reverente, tono de oración".
- Pausa configurable antes del **"Amén"**.
- Velocidad levemente reducida (0.95×) para oraciones.
