import type { PricingUnit, ProviderConfig, ProviderManifest, ProviderPricing, Usage } from '@hefesto/shared-types';

export interface ComputeUsageInput {
  manifest: ProviderManifest;
  config: ProviderConfig;
  units: number;
  unit: PricingUnit;
  durationMs: number;
}

/**
 * Builds the `Usage` every capability call reports (the pipeline turns it into a
 * `CostEntry`). Local adapters always cost $0 but still report a real `durationMs`.
 * Cloud adapters use `config.pricingOverride` first, then `manifest.pricing`; if neither
 * matches the call's unit, cost is reported as $0 rather than guessed.
 */
export function computeUsage(input: ComputeUsageInput): Usage {
  const { manifest, config, units, unit, durationMs } = input;
  if (manifest.kind === 'local') {
    return { units, unit, costUsd: 0, durationMs };
  }
  const pricing: ProviderPricing | undefined = config.pricingOverride ?? manifest.pricing;
  if (!pricing || pricing.unit !== unit) {
    return { units, unit, costUsd: 0, durationMs };
  }
  return { units, unit, costUsd: round(units * pricing.usdPerUnit), durationMs };
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
