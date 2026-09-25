import { simulateEta } from './eta';

const one = { gpu: 1, net: 3, cpu: 1 };

describe('simulateEta', () => {
  it('is 0 for an empty queue', () => {
    expect(simulateEta([], one)).toBe(0);
  });

  it('serializes jobs of the GPU lane', () => {
    const chain = (seq: number) => ({ steps: [{ lane: 'gpu' as const, ms: 100 }], priority: 0, seq });
    expect(simulateEta([chain(1), chain(2), chain(3)], one)).toBe(300);
  });

  it('overlaps lanes and respects their concurrency', () => {
    const chain = (seq: number) => ({
      steps: [
        { lane: 'net' as const, ms: 100 },
        { lane: 'gpu' as const, ms: 100 },
      ],
      priority: 0,
      seq,
    });
    // net runs all three at once (t=100), then the GPU takes them one by one.
    expect(simulateEta([chain(1), chain(2), chain(3)], one)).toBe(400);
    // With one net slot the GPU work overlaps the next net job.
    expect(simulateEta([chain(1), chain(2), chain(3)], { ...one, net: 1 })).toBe(400);
  });

  it('counts the remaining time of running jobs', () => {
    expect(
      simulateEta([{ steps: [{ lane: 'cpu', ms: 1000 }, { lane: 'cpu', ms: 50 }], priority: 0, seq: 1, runningRemainingMs: 200 }], one),
    ).toBe(250);
  });
});
