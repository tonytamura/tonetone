import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SCALE_NOTES, loadAt_, applyDrone, fadeDroneForResults, resetVoiceCounts, setLatencyHint, audioRebuilds, AudioStore, initAudio, wakeAudio, inKey, scaleNote, SCALE_ROOT } from '../../src/audio/SynthEngine';

describe('SynthEngine module', () => {
  describe('SCALE_NOTES', () => {
    it('holds two octaves of Hirajoshi up from A2', () => {
      expect(SCALE_NOTES.length).toBe(10);
      expect(SCALE_NOTES[0]).toBe(110); // A2
      expect(SCALE_NOTES[5]).toBe(220); // the octave
      // A B C E F: 0, 2, 3, 7 and 8 semitones above the root.
      expect(SCALE_NOTES.slice(0, 5).map(f => Math.round(12 * Math.log2(f / 110)))).toEqual([0, 2, 3, 7, 8]);
    });
  });

  describe('loadAt_', () => {
    it('calculates exponential voice load decay based on elapsed time', () => {
      AudioStore.load = 2.0;
      AudioStore.loadAt = 10.0;

      // At same time
      expect(loadAt_(10.0)).toBe(2.0);

      // Decayed over time
      expect(loadAt_(11.0)).toBeLessThan(2.0);
    });
  });

  describe('applyDrone and fadeDroneForResults', () => {
    it('fades drone to 0 target when results screen is ducked', () => {
      const droneGainMock = { gain: { setTargetAtTime: vi.fn() } };
      AudioStore.actx = { currentTime: 15.0 } as any;
      AudioStore.droneGain = droneGainMock as any;
      AudioStore.drone = 0.8;

      fadeDroneForResults(true);
      // ducked: gain target should be 0
      expect(droneGainMock.gain.setTargetAtTime).toHaveBeenCalledWith(0, 15.0, 0.4);

      droneGainMock.gain.setTargetAtTime.mockClear();
      fadeDroneForResults(false);
      // restored: 0.026 * drone (0.8) = 0.0208
      expect(droneGainMock.gain.setTargetAtTime).toHaveBeenCalledWith(
        expect.closeTo(0.0208, 5), 15.0, 0.4
      );
    });
  });

  describe('setLatencyHint', () => {
    it('leaves the context alone when the value does not change', () => {
      // Every preset switch re-applies latency; each used to rebuild the context.
      const was = { actx: AudioStore.actx, latency: AudioStore.latency };
      try {
        AudioStore.actx = { state: 'running', currentTime: 0 } as any;
        AudioStore.latency = 0.05;
        const before = audioRebuilds();
        setLatencyHint(0.05);
        expect(audioRebuilds()).toBe(before);
        expect(AudioStore.actx).not.toBeNull();
      } finally { AudioStore.actx = was.actx; AudioStore.latency = was.latency; }
    });
  });

  describe('resetVoiceCounts', () => {
    it('zeroes the voice counts, for a context being thrown away', () => {
      AudioStore.activeVoices = 5;
      AudioStore.thuds = 3;
      resetVoiceCounts();
      expect(AudioStore.activeVoices).toBe(0);
      expect(AudioStore.thuds).toBe(0);
    });
  });

  describe('waking a stopped context', () => {
    // Coming back to the game could leave the sound on but silent until the
    // player switched it off and on. These drive a fake context through the
    // states a browser leaves it in and check the return path recovers it.
    function fakeContext(state: string) {
      const ctx: any = { state, currentTime: 3 };
      ctx.resume = vi.fn(() => { ctx.state = 'running'; return Promise.resolve(); });
      return ctx;
    }
    const master = { gain: { setTargetAtTime: vi.fn() } };

    let saved: any;
    beforeEach(() => {
      saved = { actx: AudioStore.actx, master: AudioStore.master, droneGain: AudioStore.droneGain,
                soundOn: AudioStore.soundOn, volume: AudioStore.volume };
      AudioStore.master = master as any;
      AudioStore.droneGain = null;
      AudioStore.soundOn = true;
      AudioStore.volume = 0.9;
      master.gain.setTargetAtTime.mockClear();
    });
    afterEach(() => { Object.assign(AudioStore, saved); });

    for (const state of ['suspended', 'interrupted']) {
      it(`resumes a context left ${state}, then sets the output level again`, async () => {
        const ctx = fakeContext(state);
        AudioStore.actx = ctx;
        initAudio();
        expect(ctx.resume).toHaveBeenCalledTimes(1);
        await new Promise(r => setTimeout(r, 0));
        expect(master.gain.setTargetAtTime).toHaveBeenCalledWith(0.9, 3, 0.08);
      });
    }

    it('leaves a running context alone', () => {
      const ctx = fakeContext('running');
      AudioStore.actx = ctx;
      initAudio();
      expect(ctx.resume).not.toHaveBeenCalled();
    });

    it('does not throw when the browser refuses the resume', async () => {
      const ctx = fakeContext('suspended');
      ctx.resume = vi.fn(() => Promise.reject(new Error('not allowed')));
      AudioStore.actx = ctx;
      expect(() => initAudio()).not.toThrow();
      await new Promise(r => setTimeout(r, 0));
    });

    it('wakeAudio does what the sound toggle does: resume, and set the level', () => {
      const ctx = fakeContext('running');
      AudioStore.actx = ctx;
      wakeAudio();
      // A running context can still have been left without its level; the
      // toggle re-applies it, so returning to the page must too.
      expect(master.gain.setTargetAtTime).toHaveBeenCalledWith(0.9, 3, 0.08);
    });

    it('wakeAudio does nothing before audio has started', () => {
      AudioStore.actx = null;
      expect(() => wakeAudio()).not.toThrow();
      expect(master.gain.setTargetAtTime).not.toHaveBeenCalled();
    });
  });

  describe('inKey and scaleNote', () => {
    it('moves a pitch at most two semitones, onto a note it then leaves alone', () => {
      for (let f = 40; f < 5000; f *= 1.037) {
        const k = inKey(f);
        expect(Math.abs(12 * Math.log2(k / f)), String(f)).toBeLessThanOrEqual(2 + 1e-9);
        expect(inKey(k)).toBeCloseTo(k, 9);
      }
    });

    it('counts scale steps up and down from A2', () => {
      expect(scaleNote(0)).toBeCloseTo(SCALE_ROOT, 9);
      expect(scaleNote(5)).toBeCloseTo(SCALE_ROOT * 2, 9);
      expect(scaleNote(-5)).toBeCloseTo(SCALE_ROOT / 2, 9);
      for (let d = -10; d < 15; d++) expect(scaleNote(d + 1)).toBeGreaterThan(scaleNote(d));
    });
  });
});
