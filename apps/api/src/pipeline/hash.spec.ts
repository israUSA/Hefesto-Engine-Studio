import { inputHash, stableStringify } from './hash';

describe('inputHash', () => {
  it('ignores key order and undefined values', () => {
    expect(stableStringify({ b: 1, a: [2, { d: undefined, c: 3 }] })).toBe('{"a":[2,{"c":3}],"b":1}');
    expect(inputHash({ a: 1, b: 2 })).toBe(inputHash({ b: 2, a: 1 }));
  });

  it('changes when any input changes', () => {
    expect(inputHash({ voice: 'Kore' })).not.toBe(inputHash({ voice: 'Charon' }));
  });
});
