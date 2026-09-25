import type { ChannelTemplateDto } from '@hefesto/shared-types';

/**
 * Niche templates offered when creating a channel. They pre-fill the
 * "biblia del canal", voice and visual style; the user names the channel.
 * A fresh install has no channels (the product ships empty).
 */
export const CHANNEL_TEMPLATES: ChannelTemplateDto[] = [
  {
    id: 'devocional-cristiano',
    name: 'Devocional cristiano',
    description: 'Oraciones guiadas y versículo del día. El texto bíblico sale siempre de la Biblia local.',
    niche: 'Fe',
    defaults: {
      topic: 'Oraciones cristianas diarias y versículos',
      bible:
        'Cálido, esperanzador y respetuoso, en segunda persona. Sin promesas de milagros ni lenguaje manipulador. Sin polémica denominacional. CTA suave ("Guarda esta oración"). Formatos: versículo del día, oración guiada.',
      bibleTranslation: 'RV1909',
      durationTarget: { min: 30, max: 60 },
      voice: {
        voiceId: 'Kore',
        language: 'es',
        stylePrompt: 'voz cálida, pausada, reverente, tono de oración',
        speed: 0.95,
        pauseBeforeAmenMs: 800,
      },
      visualStyle: {
        source: 'stock',
        basePrompt: 'paisajes luminosos, amaneceres, montañas, agua, luz entre nubes',
        negativePrompt: 'rostros generados por IA, texto en la imagen',
        motion: 'kenburns',
      },
    },
  },
  {
    id: 'salmos',
    name: 'Salmos y reflexión',
    description: 'Un salmo o fragmento con una reflexión breve, en tono poético.',
    niche: 'Fe',
    defaults: {
      topic: 'Salmos con reflexión breve',
      bible:
        'Tono poético y sereno, centrado en los Salmos. Cada video presenta un salmo o fragmento y una reflexión corta. Sin polémica denominacional. CTA: "Guarda este salmo para hoy".',
      bibleTranslation: 'RV1909',
      durationTarget: { min: 30, max: 60 },
      voice: {
        voiceId: 'Kore',
        language: 'es',
        stylePrompt: 'voz cálida, pausada, evocando la poesía de los salmos',
        speed: 0.95,
        pauseBeforeAmenMs: 600,
      },
      visualStyle: {
        source: 'stock',
        basePrompt: 'agua en calma, montañas, cielos abiertos, luz dorada',
        negativePrompt: 'rostros generados por IA, texto en la imagen',
        motion: 'kenburns',
      },
    },
  },
  {
    id: 'datos-videojuegos',
    name: 'Historia y datos de videojuegos',
    description: 'Curiosidades, lore e historia de sagas. Visuales genéricos para evitar reclamos de copyright.',
    niche: 'Entretenimiento',
    defaults: {
      topic: 'Historia, lore y datos curiosos de videojuegos',
      bible:
        'Tono entusiasta y curioso, en formato de comentario y análisis. Cada dato debe tener una fuente verificable. Nunca usar sprites, arte oficial, capturas, clips ni música de los juegos: solo visuales genéricos (consolas, estética retro, setups). Avisar antes de spoilers recientes.',
      durationTarget: { min: 30, max: 60 },
      voice: {
        voiceId: 'Puck',
        language: 'es',
        stylePrompt: 'voz enérgica, entusiasta, ritmo ágil, como un narrador de curiosidades',
        speed: 1.05,
      },
      visualStyle: {
        source: 'stock',
        basePrompt: 'consolas retro, joysticks, luces neón, setups gamer, pixel art genérico',
        negativePrompt: 'personajes, logos o arte de franquicias con derechos de autor',
        motion: 'kenburns',
      },
    },
  },
  {
    id: 'motivacion-ejercicio',
    name: 'Motivación y ejercicio',
    description: 'Rutinas cortas y mensajes motivadores, con aviso de salud fijo.',
    niche: 'Bienestar',
    defaults: {
      topic: 'Motivación y rutinas de ejercicio cortas',
      bible:
        'Tono directo y motivador, sin lenguaje agresivo. Las rutinas siempre llevan un aviso de salud ("consultá a un profesional antes de empezar"). Ejercicios de bajo riesgo. Sin promesas de resultados irreales ni consejos médicos.',
      durationTarget: { min: 20, max: 45 },
      voice: {
        voiceId: 'Charon',
        language: 'es',
        stylePrompt: 'voz enérgica, directa, motivadora, ritmo marcado',
        speed: 1.1,
      },
      visualStyle: {
        source: 'stock',
        basePrompt: 'personas entrenando, gimnasios, amaneceres de rutina matutina',
        negativePrompt: 'rostros generados por IA',
        motion: 'kenburns',
      },
    },
  },
  {
    id: 'datos-curiosos',
    name: 'Datos curiosos',
    description: 'Hechos sorprendentes de ciencia, historia y naturaleza, con fuente.',
    niche: 'Educación',
    defaults: {
      topic: 'Datos curiosos de ciencia, historia y naturaleza',
      bible:
        'Tono ágil y sorprendente, sin exagerar. Cada dato debe ser verificable y citar su fuente en la descripción. Nada de pseudociencia ni rumores. CTA: "Seguí para más datos".',
      durationTarget: { min: 25, max: 50 },
      voice: {
        voiceId: 'Puck',
        language: 'es',
        stylePrompt: 'voz curiosa y clara, ritmo ágil',
        speed: 1.05,
      },
      visualStyle: {
        source: 'stock',
        basePrompt: 'naturaleza, espacio, laboratorios, mapas antiguos, macrofotografía',
        negativePrompt: 'texto en la imagen',
        motion: 'kenburns',
      },
    },
  },
];
