import { EventsService } from '../events/events.service';
import { TelemetryService } from './telemetry.service';

jest.mock('node:child_process', () => ({
  execFile: (
    _cmd: string,
    _args: string[],
    _opts: unknown,
    cb: (err: Error) => void,
  ) => cb(new Error('nvidia-smi not found')),
}));

describe('TelemetryService', () => {
  it('reports no GPU (and does not crash) when nvidia-smi is unavailable, like this dev laptop', async () => {
    const events = new EventsService();
    const service = new TelemetryService(events);

    const emitSpy = jest.spyOn(events, 'emit');
    // Reach into the private capture() via the public sample path used by the timer.
    await (service as unknown as { sample(): Promise<void> }).sample();

    expect(emitSpy).toHaveBeenCalledTimes(1);
    const event = emitSpy.mock.calls[0][0];
    expect(event.type).toBe('telemetry');
    if (event.type === 'telemetry') {
      expect(event.telemetry.gpu).toBeUndefined();
      expect(event.telemetry.cpu.threads).toBeGreaterThan(0);
      expect(typeof event.telemetry.memory.totalMb).toBe('number');
    }

    // A second sample should not throw either, and keeps not calling nvidia-smi (cached false).
    await (service as unknown as { sample(): Promise<void> }).sample();
    expect(service.current()?.gpu).toBeUndefined();

    service.onModuleDestroy();
  });
});
