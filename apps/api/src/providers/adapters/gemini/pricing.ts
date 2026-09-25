import type { ProviderPricing } from '@hefesto/shared-types';

/**
 * Approximate defaults (docs/05, sept. 2026) — always overridable per instance via
 * `ProviderConfig.pricingOverride`. Verify against the current Gemini API price sheet.
 */
export const GEMINI_TEXT_PRICING: ProviderPricing = { unit: 'token', usdPerUnit: 0.0000003 }; // ~Flash blended
export const GEMINI_TTS_PRICING: ProviderPricing = { unit: 'char', usdPerUnit: 0.0000167 }; // ~$0.015 / 900 chars
