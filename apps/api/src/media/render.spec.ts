import { buildFilterGraph, type RenderInput } from './render';

const baseInput: RenderInput = {
  scenes: [
    { path: 'scene1.png', kind: 'image', startMs: 0, endMs: 2000 },
    { path: 'scene2.mp4', kind: 'video', startMs: 2000, endMs: 4500 },
  ],
  voicePath: 'voice.wav',
  format: '9:16',
  outPath: 'out.mp4',
};

describe('buildFilterGraph', () => {
  it('adds one -i per scene plus the voice track, in order', () => {
    const graph = buildFilterGraph(baseInput, 30);
    expect(graph.inputPaths).toEqual(['scene1.png', 'scene2.mp4', 'voice.wav']);
  });

  it('feeds image scenes as a single frame (zoompan sets the length) and loops video scenes', () => {
    const graph = buildFilterGraph(baseInput, 30);
    expect(graph.inputArgs).toEqual([
      '-i', 'scene1.png',
      '-stream_loop', '-1', '-t', '2.500', '-i', 'scene2.mp4',
      '-i', 'voice.wav',
    ]);
  });

  it('builds a zoompan (Ken Burns) filter for image scenes', () => {
    const graph = buildFilterGraph(baseInput, 30);
    expect(graph.filterComplex).toContain('zoompan');
    expect(graph.filterComplex).toContain('[0:v]');
    // 2 s at 30 fps: zoompan must emit exactly 60 frames for the single input frame.
    expect(graph.filterComplex).toContain(':d=60:');
  });

  it('concatenates all scenes into a single video stream', () => {
    const graph = buildFilterGraph(baseInput, 30);
    expect(graph.filterComplex).toMatch(/\[v0\]\[v1\]concat=n=2:v=1:a=0\[vconcat\]/);
  });

  it('maps the voice track directly as audio when there is no music', () => {
    const graph = buildFilterGraph(baseInput, 30);
    expect(graph.audioLabel).toBe('[voiceOut]'); // routed through an explicit filter label
    expect(graph.filterComplex).toContain('[2:a]anull[voiceOut]'); // index 2: after the 2 scene inputs
  });

  it('adds a music input with sidechain ducking under the voice when musicPath is given', () => {
    const graph = buildFilterGraph({ ...baseInput, musicPath: 'music.mp3', musicVolume: 0.3 }, 30);
    expect(graph.inputPaths).toEqual(['scene1.png', 'scene2.mp4', 'voice.wav', 'music.mp3']);
    expect(graph.filterComplex).toContain('sidechaincompress');
    expect(graph.filterComplex).toContain('volume=0.3');
    expect(graph.audioLabel).toBe('[aout]');
  });

  it('burns subtitles with the ass filter when subsPath is given', () => {
    const graph = buildFilterGraph({ ...baseInput, subsPath: 'subs.ass' }, 30);
    expect(graph.filterComplex).toContain("ass='subs.ass'");
    expect(graph.videoLabel).toBe('[vout]');
  });

  it('overlays a watermark as an extra input when given', () => {
    const graph = buildFilterGraph({ ...baseInput, watermark: { path: 'logo.png', position: 'bottom-right' } }, 30);
    expect(graph.inputPaths).toContain('logo.png');
    expect(graph.filterComplex).toContain('overlay=W-w-24:H-h-24');
  });

  it('throws with no scenes', () => {
    expect(() => buildFilterGraph({ ...baseInput, scenes: [] }, 30)).toThrow();
  });
});
