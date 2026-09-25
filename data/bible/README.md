# RV1909 (Reina-Valera 1909)

`rv1909.json` es el texto completo de la Reina-Valera 1909 en español, la traducción por defecto de Hefesto (ver [ADR-009](../../docs/11-decisiones.md) y [08 · Nicho cristiano](../../docs/08-nicho-cristiano.md)). Se usa **solo como fuente de texto**: la IA nunca escribe ni parafrasea versículos, siempre elige una referencia y el texto sale de acá.

## Fuente

- **Origen**: [eBible.org](https://ebible.org/find/details.php?id=spaRV1909), formato USFX (`https://ebible.org/Scriptures/spaRV1909_usfx.zip`).
- **Licencia**: **Dominio público** (Reina-Valera 1909 / "Santa Biblia — Reina Valera 1909"). eBible.org publica explícitamente `copr.htm` dentro del paquete con el aviso "Public Domain" / "Dominio Público" y enlaza a la entrada de Wikipedia sobre dominio público.
- Se descargó y se generó `rv1909.json` con `tools/import-bible.ts` (ver más abajo). No se modificó el texto salvo:
  - se quitaron las etiquetas de marcado USFX (`<w>`, `<add>`, etc.) dejando el texto plano de cada versículo;
  - en los Salmos, el encabezado ("Salmo de David.", etc.), que en la versificación hebrea se cuenta dentro del versículo 1, se separó del texto del versículo (queda fuera de `rv1909.json`) porque en las ediciones impresas es un título, no parte del versículo citable.

## Verificación de integridad

- 66 libros (canon protestante completo, sin apócrifos), 31 082 versículos, sin duplicados de `(book, chapter, verse)`.
- Juan 3 tiene 36 versículos; Apocalipsis tiene 22 capítulos y 404 versículos (conteos estándar de la RV).
- Texto verificado contra dos referencias conocidas:
  - Salmos 23:1 → "JEHOVÁ es mi pastor; nada me faltará." (coincide con "Jehová es mi pastor; nada me faltará.", salvo mayúscula inicial de capítulo, una convención tipográfica habitual en esta edición).
  - Isaías 41:10 → "No temas, que yo soy contigo; no desmayes, que yo soy tu Dios que te esfuerzo: siempre te ayudaré, siempre te sustentaré con la diestra de mi justicia." (coincide exactamente).

## Formato

```json
{
  "translation": "RV1909",
  "verses": [
    { "book": "Salmos", "chapter": 23, "verse": 1, "text": "JEHOVÁ es mi pastor; nada me faltará." },
    ...
  ]
}
```

`book` usa el nombre canónico en español (ver `apps/api/src/bible/books.ts`, que además resuelve abreviaturas como "Sal", "Jn", "1 Co", "Is"/"Isaías" con o sin tilde).

Tamaño del archivo: ~5.3 MB (bien por debajo del límite de 10 MB).

## Regenerarlo

```
npx ts-node --transpile-only --project tools/tsconfig.json tools/import-bible.ts
```

Vuelve a descargar el zip de eBible.org, lo desempaqueta con un lector de ZIP mínimo (sin dependencias nuevas: usa `zlib.inflateRawSync` de Node), parsea el USFX y sobrescribe `data/bible/rv1909.json`. También corre `seedDatabase`-style import directo a la tabla `bible_verses` si se le pasa `--db`.
