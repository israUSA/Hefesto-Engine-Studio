import { makeFfmpegProgressParser } from './process';

describe('makeFfmpegProgressParser', () => {
  it('converts out_time_ms (microseconds, despite the name) into a 0-1 fraction of total duration', () => {
    const parse = makeFfmpegProgressParser(10_000); // 10s total
    expect(parse(['frame=1', 'out_time_ms=5000000'])).toBeCloseTo(0.5, 5); // 5s in
  });

  it('also understands the out_time_us key name used by some ffmpeg builds', () => {
    const parse = makeFfmpegProgressParser(10_000);
    expect(parse(['out_time_us=2500000'])).toBeCloseTo(0.25, 5);
  });

  it('clamps the fraction to [0, 1]', () => {
    const parse = makeFfmpegProgressParser(1_000);
    expect(parse(['out_time_ms=5000000'])).toBe(1);
  });

  it('reports 1 once progress=end is seen', () => {
    const parse = makeFfmpegProgressParser(10_000);
    parse(['out_time_ms=1000000']);
    expect(parse(['progress=end'])).toBe(1);
  });

  it('returns undefined when no progress key is present yet', () => {
    const parse = makeFfmpegProgressParser(10_000);
    expect(parse(['frame=1', 'fps=30.0'])).toBeUndefined();
  });

  it('is stateful: later calls without a progress key keep the last known fraction', () => {
    const parse = makeFfmpegProgressParser(10_000);
    parse(['out_time_ms=3000000']);
    expect(parse(['frame=90'])).toBeCloseTo(0.3, 5);
  });
});
