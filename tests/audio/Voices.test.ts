import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { playNote, playSwoosh, playKnock, getBoomProps, boomPitches, playBoom, playCountdownTick, playMagneticElectricSound, BOND_VOICE, BREAK_VOICE, BOOM_HARMONICS, KNOCK_MODES, KNOCK_RING, TICK_LEVEL, TICK_GO_LEVEL, SWOOSH_METAL_MODES, boomEchoSpec, getMagnetLockProps, PAIR_LIFT, PAIR_SUB_LIFT, PAIR_DUR, PAIR_VOL, pickGameBoom, playRandomGameBoom, resetAttractBooms, getWhiteBlackBoomVol, boomVolumeRamp, BOOM_VOL_RAMP, WHITE_BLACK_VOL_RAMP, BOOM_TIER_COUNT } from '../../src/audio/Voices';
import { AudioStore, BEAT, SCALE_NOTES, SCALE_ROOT, SCALE_STEPS, inKey } from '../../src/audio/SynthEngine';
import { clickHz, playBinauralClick, resetUiSoundsForTesting, setClickLockMs } from '../../src/audio/UiSounds';

describe('Voices module', () => {
  beforeEach(() => {
    AudioStore.soundOn = true;
    AudioStore.activeVoices = 0;
    AudioStore.thuds = 0;
    AudioStore.clickVol = 1.0;
    AudioStore.lockVol = 1.0;
    AudioStore.breakVol = 1.0;
    AudioStore.boomVol = 1.0;
  });

  describe('playMagneticElectricSound synthesis', () => {
    it('creates FM carrier/modulator nodes, lowpass filter sweep, and sub oscillator', () => {
      const mockGainNode = {
        gain: {
          value: 1,
          setValueAtTime: vi.fn(),
          linearRampToValueAtTime: vi.fn(),
        },
        connect: vi.fn(),
      };
      const mockOscNode = {
        type: '',
        frequency: { value: 440, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        onended: null as any,
      };
      const mockFilterNode = {
        type: '',
        Q: { value: 1 },
        frequency: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
        connect: vi.fn(),
      };
      const mockCtx = {
        currentTime: 3.0,
        createGain: vi.fn(() => mockGainNode),
        createBiquadFilter: vi.fn(() => mockFilterNode),
        createOscillator: vi.fn(() => mockOscNode),
        createBufferSource: vi.fn(() => ({
          buffer: null,
          playbackRate: { value: 1 },
          connect: vi.fn(),
          start: vi.fn(),
          stop: vi.fn(),
        })),
      };

      AudioStore.actx = mockCtx as any;
      AudioStore.master = {} as any;
      AudioStore.noiseBuf = {} as any;

      playMagneticElectricSound(0, { ignoreOptionsGuard: true });

      expect(mockCtx.createGain).toHaveBeenCalled();
      expect(mockCtx.createBiquadFilter).toHaveBeenCalled();
      expect(mockCtx.createOscillator).toHaveBeenCalled();
      expect(mockGainNode.gain.setValueAtTime).toHaveBeenCalledWith(0.0001, 3.0);
    });
  });

  describe('white ball launch swoosh', () => {
    // Every filter and oscillator the swoosh built, with the pan position of the
    // side it was wired to, so the two mode banks can be told apart.
    function swoosh(xNorm = 0) {
      const pans: number[] = [];
      const bandpass: { freq: number; q: number }[] = [];
      const subFreqs: number[] = [];
      let source: any = null;
      const mockCtx = {
        currentTime: 0,
        createGain: vi.fn(() => ({
          gain: {
            value: 1, setValueAtTime: vi.fn(),
            linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(),
          },
          connect: vi.fn(),
        })),
        createBufferSource: vi.fn(() => {
          const node = {
            buffer: null, loop: false, playbackRate: { value: 1 },
            connect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null as any,
          };
          // The first is the bank source; the second is the onset scrape.
          if (!source) source = node;
          return node;
        }),
        // Each node schedules its start frequency twice, at `now` and again at
        // `t`; only the first is recorded, so one node means one entry.
        createBiquadFilter: vi.fn(() => {
          let seen = false;
          const node = {
            type: '', Q: { value: 1 },
            frequency: {
              value: 0,
              setValueAtTime: vi.fn((v: number) => {
                if (seen || node.type !== 'bandpass') return;
                seen = true;
                // The onset scrape is a deliberately broad bandpass; only the
                // narrow, ringing ones are mode-bank filters.
                if (node.Q.value < 11) return;
                bandpass.push({ freq: v, q: node.Q.value });
              }),
              linearRampToValueAtTime: vi.fn(),
            },
            connect: vi.fn(),
          };
          return node;
        }),
        createOscillator: vi.fn(() => {
          let seen = false;
          const node = {
            type: '',
            frequency: {
              value: 0,
              setValueAtTime: vi.fn((v: number) => {
                if (seen) return;
                seen = true;
                subFreqs.push(v);
              }),
              linearRampToValueAtTime: vi.fn(),
            },
            connect: vi.fn(), start: vi.fn(), stop: vi.fn(),
          };
          return node;
        }),
        createStereoPanner: vi.fn(() => ({ pan: { value: 0 }, connect: vi.fn() })),
      };
      AudioStore.actx = mockCtx as any;
      AudioStore.noiseBuf = { duration: 2.0 } as any;
      AudioStore.master = {} as any;
      AudioStore.wetBus = null;
      AudioStore.thuds = 0;
      AudioStore.swooshAt = -9;
      playSwoosh(xNorm, 0.8, { ignoreOptionsGuard: true, isWhite: true });
      for (const call of (mockCtx.createStereoPanner as any).mock.results) {
        pans.push(call.value.pan.value);
      }
      return { pans, bandpass, subFreqs, source };
    }

    it('builds one mode bank per ear instead of a single mono chain', () => {
      const { pans } = swoosh(0);
      // Two panners, one hard left and one hard right — not one placed panner.
      expect(pans.length).toBe(2);
      expect(Math.min(...pans)).toBeLessThan(-0.5);
      expect(Math.max(...pans)).toBeGreaterThan(0.5);
    });

    it('offsets the two banks by BEAT Hz, so they actually beat', () => {
      const { bandpass, subFreqs } = swoosh(0);
      // Four modes per side.
      expect(bandpass.length).toBe(SWOOSH_METAL_MODES.length * 2);
      // The fundamental of each bank: same nominal frequency, BEAT Hz apart.
      const fundamentals = bandpass
        .filter((b) => b.freq < 600)
        .map((b) => b.freq)
        .sort((a, b) => a - b);
      expect(fundamentals.length).toBe(2);
      expect(fundamentals[1] - fundamentals[0]).toBeCloseTo(BEAT, 5);

      // The binaural sub under it is split the same way.
      const subs = subFreqs.filter((f) => f < 300).sort((a, b) => a - b);
      expect(subs.length).toBe(2);
      expect(subs[1] - subs[0]).toBeCloseTo(BEAT, 5);
    });

    it('tunes the banks to inharmonic metal-bar ratios, not a harmonic series', () => {
      const { bandpass } = swoosh(0);
      // Sorted, the two banks interleave into pairs (mode n left, mode n right);
      // taking every second entry walks one bank's modes in order.
      const oneSide = bandpass
        .map((b) => b.freq)
        .sort((a, b) => a - b)
        .filter((_, i) => i % 2 === 0);
      const ratios = oneSide.map((f) => f / oneSide[0]);
      // 1 : 2.76 : 5.40 : 8.93 — a struck bar, not 1 : 2 : 3 : 4.
      expect(ratios.length).toBe(SWOOSH_METAL_MODES.length);
      for (let i = 0; i < ratios.length; i++) {
        expect(ratios[i]).toBeCloseTo(SWOOSH_METAL_MODES[i].ratio, 1);
      }
      // Narrow, ringing bands are what make it read as metal.
      for (const b of bandpass) expect(b.q).toBeGreaterThanOrEqual(11);
    });

    it('keeps the throw position as a bias without collapsing the width', () => {
      const left = swoosh(-1).pans;
      const right = swoosh(1).pans;
      // Both throws still reach both ears; the pair just leans.
      expect(Math.min(...left)).toBeLessThan(-0.5);
      expect(Math.max(...left)).toBeGreaterThan(0.5);
      expect(right[0]).toBeGreaterThan(left[0]);
      expect(right[1]).toBeGreaterThan(left[1]);
    });
  });

  describe('getBoomProps level scaling', () => {
    it('scales tone and duration monotonically across levels 0-5, 5-10, 10-15, 15-20, 20+', () => {
      const lvl0 = getBoomProps(3);
      const lvl1 = getBoomProps(7);
      const lvl2 = getBoomProps(12);
      const lvl3 = getBoomProps(18);
      const lvl4 = getBoomProps(25);

      // Verify tone increases for each level
      expect(lvl1.tone).toBeGreaterThan(lvl0.tone);
      expect(lvl2.tone).toBeGreaterThan(lvl1.tone);
      expect(lvl3.tone).toBeGreaterThan(lvl2.tone);
      expect(lvl4.tone).toBeGreaterThan(lvl3.tone);

      // Verify duration increases for each level
      expect(lvl1.dur).toBeGreaterThan(lvl0.dur);
      expect(lvl2.dur).toBeGreaterThan(lvl1.dur);
      expect(lvl3.dur).toBeGreaterThan(lvl2.dur);
      expect(lvl4.dur).toBeGreaterThan(lvl3.dur);
    });

    it('is loudest at Level 15-20, not at the top tier', () => {
      const vols = [3, 7, 12, 18, 25].map((n) => getBoomProps(n).vol);
      // Rises to the 15-19 tier...
      expect(vols[1]).toBeGreaterThan(vols[0]);
      expect(vols[2]).toBeGreaterThan(vols[1]);
      expect(vols[3]).toBeGreaterThan(vols[2]);
      // ...then comes back down. Deliberate: the 20+ boom is the biggest event
      // by duration, tone and its 808 sub layer, so it does not need the gain
      // too, and taking it loudest as well cost headroom everything else needed.
      expect(vols[4]).toBeLessThan(vols[3]);
      expect(Math.max(...vols)).toBe(vols[3]);
    });

    it('never asks for a level past the headroom the trim assumes', () => {
      // At vol 1.5 a 20+ boom alone measured -0.2 dBFS, which left nothing for
      // any voice landing on top of it.
      for (const n of [0, 3, 7, 12, 18, 25, 200]) {
        expect(getBoomProps(n).vol).toBeLessThanOrEqual(1.0);
        expect(getWhiteBlackBoomVol(n)).toBeLessThanOrEqual(1.0);
      }
    });
  });

  describe('white-on-black volume ramp', () => {
    it('is loudest at Level 10-15, a tier below the ordinary boom', () => {
      const vols = [3, 7, 12, 18, 25].map(getWhiteBlackBoomVol);
      expect(vols[1]).toBeGreaterThan(vols[0]);
      expect(vols[2]).toBeGreaterThan(vols[1]);
      // Falls away above the peak: this voice is lifted and carries a metal
      // ring, so held at the top tiers it reads harsh rather than bigger.
      expect(vols[3]).toBeLessThan(vols[2]);
      expect(vols[4]).toBeLessThan(vols[3]);
      expect(Math.max(...vols)).toBe(vols[2]);
    });

    it('peaks a tier below where the ordinary boom peaks', () => {
      const tiers = [3, 7, 12, 18, 25];
      const plainPeak = tiers[
        tiers.map((n) => getBoomProps(n).vol)
          .reduce((best, v, i, a) => (v > a[best] ? i : best), 0)];
      const wbPeak = tiers[
        tiers.map(getWhiteBlackBoomVol)
          .reduce((best, v, i, a) => (v > a[best] ? i : best), 0)];
      expect(plainPeak).toBe(18);
      expect(wbPeak).toBe(12);
    });

    it('climbs evenly from the floor to the peak, across every tier below it', () => {
      // The point of the ramp: the peak tier sits at the top of the range and
      // every tier under it is a step on one even climb up to it, rather than
      // keeping whatever value it happened to have before the peak moved.
      for (const [ramp, peak] of [[BOOM_VOL_RAMP, 3], [WHITE_BLACK_VOL_RAMP, 2]] as [number[], number][]) {
        expect(ramp[peak]).toBe(1);
        const steps: number[] = [];
        for (let i = 1; i <= peak; i++) steps.push(ramp[i] - ramp[i - 1]);
        for (const step of steps) {
          expect(step).toBeGreaterThan(0);
          expect(step).toBeCloseTo(steps[0], 1);
        }
      }
    });

    it('puts the peak at the top of the range for both variants', () => {
      expect(Math.max(...BOOM_VOL_RAMP)).toBe(1);
      expect(Math.max(...WHITE_BLACK_VOL_RAMP)).toBe(1);
      expect(BOOM_VOL_RAMP.length).toBe(BOOM_TIER_COUNT);
      expect(WHITE_BLACK_VOL_RAMP.length).toBe(BOOM_TIER_COUNT);
    });

    it('rebuilds the whole ramp when the peak moves', () => {
      // Moving a peak is one number, and every tier below it is redistributed.
      const atTop = boomVolumeRamp(4, 0.4, 0.15);
      const atBottom = boomVolumeRamp(0, 0.4, 0.15);
      expect(atTop[4]).toBe(1);
      expect(atTop).toEqual([...atTop].sort((a, b) => a - b));
      expect(atBottom[0]).toBe(1);
      expect(atBottom).toEqual([...atBottom].sort((a, b) => b - a));
    });

    it('applies the tier ramp downstream of the compressor, not into it', () => {
      // The bug this guards: the ramp used to scale the envelope, upstream of a
      // 4.5:1 compressor whose makeup gain handed the cut straight back. The
      // ramp's full 8 dB spread reached the output as 1.8 dB, so the tiers were
      // separated only by what the compressor does not touch — duration, the 808
      // sub, the echo send — all of which grow with chain size, leaving 20+ the
      // loudest however the ramp was written.
      function levels(boomSize: number) {
        const gains: { value: number }[] = [];
        const envPeaks: number[] = [];
        const mockCtx = {
          currentTime: 0,
          createGain: vi.fn(() => {
            const node = {
              gain: {
                value: 1,
                setValueAtTime: vi.fn(),
                linearRampToValueAtTime: vi.fn((v: number) => { envPeaks.push(v); }),
                exponentialRampToValueAtTime: vi.fn(),
              },
              connect: vi.fn(),
            };
            gains.push(node.gain as any);
            return node;
          }),
          createBiquadFilter: vi.fn(() => ({
            type: '', Q: { value: 1, setValueAtTime: vi.fn() },
            frequency: { value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
            connect: vi.fn(),
          })),
          createDynamicsCompressor: vi.fn(() => ({
            threshold: { setValueAtTime: vi.fn() }, knee: { setValueAtTime: vi.fn() },
            ratio: { setValueAtTime: vi.fn() }, attack: { setValueAtTime: vi.fn() },
            release: { setValueAtTime: vi.fn() }, connect: vi.fn(),
          })),
          createDelay: vi.fn(() => ({ delayTime: { setValueAtTime: vi.fn() }, connect: vi.fn() })),
          createStereoPanner: vi.fn(() => ({ pan: { setValueAtTime: vi.fn() }, connect: vi.fn() })),
          createOscillator: vi.fn(() => ({
            type: '',
            frequency: { value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
            connect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null as any,
          })),
        };
        AudioStore.actx = mockCtx as any;
        AudioStore.master = {} as any;
        AudioStore.wetBus = null;
        AudioStore.boomVol = 1.0;
        playBoom(boomSize, 0, { ignoreOptionsGuard: true });
        // The trim is the one gain whose value is set outright rather than ramped.
        const trim = gains.find((g) => g.value !== 1 && g.value !== 0.0001);
        return { trim: trim ? trim.value : 0, envPeak: Math.max(...envPeaks) };
      }

      const peakTier = levels(18);
      const topTier = levels(25);

      // Both drive the compressor identically...
      expect(topTier.envPeak).toBeCloseTo(peakTier.envPeak, 6);
      // ...and are separated only after it, where nothing compensates.
      expect(topTier.trim).toBeLessThan(peakTier.trim);
      expect(peakTier.trim / topTier.trim).toBeCloseTo(
        BOOM_VOL_RAMP[3] / BOOM_VOL_RAMP[4], 5);
    });

    it('has its own ramp, not a flat multiple of the ordinary one', () => {
      const ratios = [3, 7, 12, 18, 25].map(
        (n) => getWhiteBlackBoomVol(n) / getBoomProps(n).vol);
      const spread = Math.max(...ratios) - Math.min(...ratios);
      // It used to be exactly 0.88x at every tier; the two curves now diverge.
      expect(spread).toBeGreaterThan(0.1);
    });
  });

  describe('playBoom audio synthesis', () => {
    it('creates lowpass filter, gain envelope, sub-bass oscillator and binaural oscillators', () => {
      const mockGainNode = {
        gain: {
          value: 1,
          setValueAtTime: vi.fn(),
          linearRampToValueAtTime: vi.fn(),
        },
        connect: vi.fn(),
      };
      const mockOscNode = {
        type: '',
        frequency: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      };
      const mockFilterNode = {
        type: '',
        Q: { setValueAtTime: vi.fn() },
        frequency: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
        connect: vi.fn(),
      };
      const mockCompNode = {
        threshold: { setValueAtTime: vi.fn() },
        knee: { setValueAtTime: vi.fn() },
        ratio: { setValueAtTime: vi.fn() },
        attack: { setValueAtTime: vi.fn() },
        release: { setValueAtTime: vi.fn() },
        connect: vi.fn(),
      };
      const mockCtx = {
        currentTime: 2.0,
        createGain: vi.fn(() => mockGainNode),
        createBiquadFilter: vi.fn(() => mockFilterNode),
        createDynamicsCompressor: vi.fn(() => mockCompNode),
        createOscillator: vi.fn(() => mockOscNode),
        createDelay: vi.fn(() => ({
          delayTime: { setValueAtTime: vi.fn() },
          connect: vi.fn(),
        })),
      };

      AudioStore.actx = mockCtx as any;
      AudioStore.master = {} as any;

      playBoom(12, 0);

      expect(mockCtx.createGain).toHaveBeenCalled();
      expect(mockCtx.createBiquadFilter).toHaveBeenCalled();
      expect(mockCtx.createOscillator).toHaveBeenCalled();
      expect(mockGainNode.gain.setValueAtTime).toHaveBeenCalledWith(0.0001, 2.0);
    });
  });

  describe('playSwoosh micro-vibration filtering', () => {
    it('ignores tiny forces (normForce < 0.03) for hit thuds to prevent idle crackling', () => {
      // Mock AudioContext
      const mockGainNode = {
        gain: {
          value: 1,
          setValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
          linearRampToValueAtTime: vi.fn(),
        },
        connect: vi.fn(),
      };
      const mockCtx = {
        currentTime: 10.0,
        createGain: vi.fn(() => mockGainNode),
        createBufferSource: vi.fn(() => ({
          buffer: null,
          playbackRate: { value: 1 },
          connect: vi.fn(),
          start: vi.fn(),
          stop: vi.fn(),
        })),
        createBiquadFilter: vi.fn(() => ({
          type: '',
          Q: { value: 1 },
          frequency: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
          connect: vi.fn(),
        })),
        createOscillator: vi.fn(() => ({
          type: '',
          frequency: { value: 0, setValueAtTime: vi.fn() },
          connect: vi.fn(),
          start: vi.fn(),
          stop: vi.fn(),
        })),
      };

      AudioStore.actx = mockCtx as any;
      AudioStore.noiseBuf = {} as any;
      AudioStore.master = {} as any;

      // Micro force (< 0.03)
      playKnock(0, 0.01, 0, 0.5);
      expect(mockCtx.createGain).not.toHaveBeenCalled();

      // Normal force (>= 0.03)
      playKnock(0, 0.2, 0, 0.5);
      expect(mockCtx.createGain).toHaveBeenCalled();
      // Gain node initialized at 0.0001 immediately
      expect(mockGainNode.gain.value).toBe(0.0001);
      expect(mockGainNode.gain.setValueAtTime).toHaveBeenCalledWith(0.0001, 10.0);
    });
  });

  describe('playKnock tuning', () => {
    it("rings each ball at its colour's lock note, one octave up", () => {
      const fundamentals: number[] = [];
      const mockCtx = {
        currentTime: 20.0,
        createGain: vi.fn(() => ({
          gain: { value: 1, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
          connect: vi.fn(),
        })),
        createBufferSource: vi.fn(() => ({
          buffer: null, playbackRate: { value: 1 }, connect: vi.fn(), start: vi.fn(), stop: vi.fn(),
        })),
        createBiquadFilter: vi.fn(() => ({
          type: '', Q: { value: 1 }, frequency: { value: 0, setValueAtTime: vi.fn() }, connect: vi.fn(),
        })),
        createOscillator: vi.fn(() => ({
          type: '',
          frequency: { value: 0, setValueAtTime: vi.fn((v: number) => { fundamentals.push(v); }) },
          connect: vi.fn(), start: vi.fn(), stop: vi.fn(),
        })),
      };
      AudioStore.actx = mockCtx as any;
      AudioStore.noiseBuf = {} as any;
      AudioStore.master = {} as any;
      AudioStore.thudAt = -9;

      const relRed = 0, relBlue = 2 / 6;
      playKnock(0, 0.6, relRed, relBlue);

      const lockNote = (rel: number) => SCALE_NOTES[Math.floor(rel * 10)] * BOND_VOICE.mul;
      expect(lockNote(relRed)).not.toBe(lockNote(relBlue));
      // Each partial is a binaural pair, ±BEAT/2 around the note.
      for (const rel of [relRed, relBlue]) {
        expect(fundamentals).toContain(lockNote(rel) * 2 - BEAT / 2);
        expect(fundamentals).toContain(lockNote(rel) * 2 + BEAT / 2);
      }
    });

    it('rings like a struck piano string, not a wooden bar', () => {
      // A bar's modes are 1 : 3 : 6 and gone inside 90ms. A string's are the
      // harmonic series, stretched a little sharp by its stiffness, with the
      // fundamental ringing longest.
      KNOCK_MODES.forEach((m, n) => {
        const exact = n + 1;
        expect(m.ratio, `partial ${exact}`).toBeGreaterThanOrEqual(exact);
        expect(m.ratio, `partial ${exact}`).toBeLessThan(exact * 1.01);
        if (n) {
          expect(m.amp, `partial ${exact}`).toBeLessThan(KNOCK_MODES[n - 1].amp);
          expect(m.decay, `partial ${exact}`).toBeLessThan(KNOCK_MODES[n - 1].decay);
        }
      });
      expect(KNOCK_RING).toBe(KNOCK_MODES[0].decay);
      // Long enough to be a note rather than a click, short enough that the most
      // frequent voice in the game does not turn the table into mud. 0.42s was
      // tried and was too long.
      expect(KNOCK_RING).toBeGreaterThan(0.1);
      expect(KNOCK_RING).toBeLessThan(0.25);
    });

    it('keeps the countdown tick under the voices it plays over', () => {
      // It bypasses the volume knobs and the ducking, and sits where the ear is
      // most sensitive, so it carries further than its number suggests.
      expect(TICK_LEVEL).toBeLessThan(0.03);
      expect(TICK_GO_LEVEL).toBeGreaterThan(TICK_LEVEL);
    });
  });

  describe('playNote gain initialization', () => {
    it('initializes gain nodes immediately to 0.0001 at currentTime', () => {
      const mockGainNode = {
        gain: {
          value: 1,
          setValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
          linearRampToValueAtTime: vi.fn(),
        },
        connect: vi.fn(),
      };
      const mockCtx = {
        currentTime: 5.0,
        createGain: vi.fn(() => mockGainNode),
        createBufferSource: vi.fn(() => ({
          buffer: null,
          playbackRate: { value: 1 },
          connect: vi.fn(),
          start: vi.fn(),
          stop: vi.fn(),
        })),
        createBiquadFilter: vi.fn(() => ({
          type: '',
          Q: { value: 1 },
          frequency: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
          connect: vi.fn(),
        })),
        createOscillator: vi.fn(() => ({
          type: '',
          frequency: { value: 440, exponentialRampToValueAtTime: vi.fn() },
          connect: vi.fn(),
          start: vi.fn(),
          stop: vi.fn(),
        })),
      };

      AudioStore.actx = mockCtx as any;
      AudioStore.noiseBuf = {} as any;
      AudioStore.master = {} as any;

      playNote(0.5, 0, 'bond');

      expect(mockCtx.createGain).toHaveBeenCalled();
      expect(mockGainNode.gain.value).toBe(0.0001);
      expect(mockGainNode.gain.setValueAtTime).toHaveBeenCalledWith(0.0001, 5.0);
    });
  });

  describe('black-pair magnet lock', () => {
    // Every oscillator start frequency the call scheduled, so the two variants
    // can be compared as whole spectra rather than one hand-picked node.
    function arcFrequencies(isPair: boolean): number[] {
      const freqs: number[] = [];
      const gain = () => ({
        gain: { value: 1, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
        connect: vi.fn(),
      });
      const mockCtx = {
        currentTime: 0,
        createGain: vi.fn(gain),
        createBiquadFilter: vi.fn(() => ({
          type: '', Q: { value: 1, setValueAtTime: vi.fn() },
          frequency: { value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
          connect: vi.fn(),
        })),
        createStereoPanner: undefined,
        createOscillator: vi.fn(() => ({
          type: '',
          frequency: {
            value: 0,
            setValueAtTime: vi.fn((v: number) => { freqs.push(v); }),
            linearRampToValueAtTime: vi.fn(),
          },
          connect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null as any,
        })),
        createBufferSource: vi.fn(() => ({
          buffer: null, playbackRate: { value: 1 },
          connect: vi.fn(), start: vi.fn(), stop: vi.fn(),
        })),
      };
      AudioStore.actx = mockCtx as any;
      AudioStore.master = {} as any;
      AudioStore.noiseBuf = {} as any;
      AudioStore.activeVoices = 0;
      playMagneticElectricSound(0, { ignoreOptionsGuard: true, isPair });
      return freqs;
    }

    it('lifts every oscillator above the single-black lock', () => {
      const single = arcFrequencies(false);
      const pair = arcFrequencies(true);

      expect(single.length).toBeGreaterThan(0);
      expect(pair.length).toBe(single.length);
      for (let i = 0; i < single.length; i++) {
        expect(pair[i]).toBeGreaterThan(single[i]);
      }
    });

    it('carries the square arc up a clear interval, not a nudge', () => {
      const single = arcFrequencies(false);
      const pair = arcFrequencies(true);
      // The FM carrier: the loudest, most identifiable part of the lock.
      // `lockTone` scales the arc, so the carrier is not at a bare 2400 Hz.
      const carrier = single.indexOf(inKey(2400 * AudioStore.lockTone));
      expect(carrier).toBeGreaterThanOrEqual(0);
      // The realised interval is not exactly `PAIR_LIFT`, and cannot be: both
      // carriers are snapped to the scale by `inKey`, and a fifth above a
      // Hirajoshi note is not always another Hirajoshi note. (It was exact
      // while the lift was an octave, which is scale-invariant.) The snap moves
      // it by about 2 cents here — inaudible, and far short of collapsing the
      // interval, which is what this guards.
      const interval = pair[carrier] / single[carrier];
      expect(Math.abs(interval - PAIR_LIFT) / PAIR_LIFT).toBeLessThan(0.03);
      expect(interval).toBeGreaterThan(1.3);
    });

    it('scales the arc with lockTone and leaves the suction sub alone', () => {
      const was = AudioStore.lockTone;
      try {
        // Whatever the knob is set to, the arc follows it and the sub does not.
        // That is the point of the knob: turning it down shifts the voice's
        // weight onto the sub rather than only taking brightness away.
        for (const tone of [0.15, 0.3, 1, 1.5]) {
          AudioStore.lockTone = tone;
          const freqs = arcFrequencies(false);
          expect(freqs, `carrier at lockTone ${tone}`).toContain(inKey(2400 * tone));
          expect(freqs, `sub at lockTone ${tone}`).toContain(inKey(130));
        }
      } finally {
        AudioStore.lockTone = was;
      }
    });
  });

  describe('white-on-black boom voice', () => {
    function boom(whiteBlack: boolean) {
      const starts: number[] = [];
      let oscCount = 0;
      const mockCtx = {
        currentTime: 0,
        createGain: vi.fn(() => ({
          gain: {
            value: 1, setValueAtTime: vi.fn(),
            linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(),
          },
          connect: vi.fn(),
        })),
        createBiquadFilter: vi.fn(() => ({
          type: '', Q: { value: 1, setValueAtTime: vi.fn() },
          frequency: { value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
          connect: vi.fn(),
        })),
        createDynamicsCompressor: vi.fn(() => ({
          threshold: { setValueAtTime: vi.fn() }, knee: { setValueAtTime: vi.fn() },
          ratio: { setValueAtTime: vi.fn() }, attack: { setValueAtTime: vi.fn() },
          release: { setValueAtTime: vi.fn() }, connect: vi.fn(),
        })),
        createDelay: vi.fn(() => ({
          delayTime: { setValueAtTime: vi.fn() },
          connect: vi.fn(),
        })),
        createStereoPanner: vi.fn(() => ({ pan: { setValueAtTime: vi.fn() }, connect: vi.fn() })),
        createOscillator: vi.fn(() => {
          oscCount++;
          return {
            type: '',
            frequency: {
              value: 0,
              setValueAtTime: vi.fn((v: number) => { starts.push(v); }),
              linearRampToValueAtTime: vi.fn(),
            },
            connect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null as any,
          };
        }),
      };
      AudioStore.actx = mockCtx as any;
      AudioStore.master = {} as any;
      playBoom(7, 0, { ignoreOptionsGuard: true, whiteBlack });
      return { starts, oscCount };
    }

    it('dives from a higher pitch than the ordinary boom of the same chain size', () => {
      const plain = boom(false);
      const lifted = boom(true);
      const plainDive = boomPitches(7), liftedDive = boomPitches(7, true);

      // The binaural pair starts at the dive's start, offset ±BEAT/2. Name that
      // pair exactly: the lifted boom's ring sits far above it and would
      // otherwise satisfy a loose "something got higher" check on its own.
      expect(plain.starts).toContain(plainDive.start + 2.5);
      expect(plain.starts).toContain(plainDive.start - 2.5);
      expect(lifted.starts).toContain(liftedDive.start + 2.5);
      expect(lifted.starts).toContain(liftedDive.start - 2.5);
      expect(liftedDive.start).toBeGreaterThan(plainDive.start);
    });

    it('layers a struck-metal ring the ordinary boom does not have', () => {
      const plain = boom(false);
      const lifted = boom(true);
      expect(lifted.oscCount).toBe(plain.oscCount + 2);
    });

    it('leaves the ordinary boom with no metal above its own dive and partials', () => {
      // The lifted boom's ring sits far above everything the plain one has: its
      // dive, the binaural pair around it, and the ×2 and ×3 partials that carry
      // the pitch on a small speaker.
      const plain = boom(false);
      const top = boomPitches(7).start * Math.max(...BOOM_HARMONICS.map(h => h.ratio));
      expect(Math.max(...plain.starts)).toBeCloseTo(top, 4);
      expect(Math.max(...boom(true).starts)).toBeGreaterThan(top * 1.5);
    });
  });
  describe('boom echo', () => {
    it('grows the tail and the feedback with the size of the boom', () => {
      const small = boomEchoSpec(2, false);
      const big = boomEchoSpec(25, false);
      expect(big.feedback).toBeGreaterThan(small.feedback);
      expect(big.tail).toBeGreaterThan(small.tail);
      expect(big.left).toBeGreaterThan(small.left);
    });

    it('keeps the send flat, so echoes cannot undo the volume ramp', () => {
      // Delay times, feedback and tail scale with the chain — that is the drama.
      // The send is a level, and the echoes tap off `trim`, downstream of the
      // tier ramp: growing it with chain size handed the biggest booms back the
      // loudness the ramp had just taken off them.
      const sends = [0, 3, 7, 12, 18, 25].map((n) => boomEchoSpec(n, false).send);
      for (const send of sends) expect(send).toBeCloseTo(sends[0], 6);
    });

    it('always terminates: feedback stays below unity at every chain size', () => {
      for (const n of [0, 1, 3, 7, 12, 18, 25, 200]) {
        const spec = boomEchoSpec(n, false);
        expect(spec.feedback).toBeGreaterThan(0);
        expect(spec.feedback).toBeLessThan(1);
        expect(spec.tail).toBeGreaterThan(0);
      }
    });

    it('keeps the two delays off a simple multiple, so repeats scatter', () => {
      for (const n of [0, 3, 7, 12, 18, 25]) {
        const spec = boomEchoSpec(n, false);
        const ratio = spec.right / spec.left;
        expect(ratio).toBeGreaterThan(1);
        // Not 1.5× or 2× either, which would line the repeats back up.
        for (const simple of [1.5, 2]) {
          expect(Math.abs(ratio - simple)).toBeGreaterThan(0.05);
        }
      }
    });

    it('lets the metal boom ring brighter than the bass one', () => {
      expect(boomEchoSpec(7, true).damp).toBeGreaterThan(boomEchoSpec(7, false).damp);
    });

    it('builds a cross-fed pair of delays on the boom', () => {
      const delays: any[] = [];
      const mockCtx = {
        currentTime: 0,
        createGain: vi.fn(() => ({
          gain: {
            value: 1, setValueAtTime: vi.fn(),
            linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(),
          },
          connect: vi.fn(),
        })),
        createBiquadFilter: vi.fn(() => ({
          type: '', Q: { value: 1, setValueAtTime: vi.fn() },
          frequency: { value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
          connect: vi.fn(),
        })),
        createDynamicsCompressor: vi.fn(() => ({
          threshold: { setValueAtTime: vi.fn() }, knee: { setValueAtTime: vi.fn() },
          ratio: { setValueAtTime: vi.fn() }, attack: { setValueAtTime: vi.fn() },
          release: { setValueAtTime: vi.fn() }, connect: vi.fn(),
        })),
        createDelay: vi.fn(() => {
          const node = { delayTime: { setValueAtTime: vi.fn() }, connect: vi.fn() };
          delays.push(node);
          return node;
        }),
        createStereoPanner: vi.fn(() => ({ pan: { setValueAtTime: vi.fn() }, connect: vi.fn() })),
        createOscillator: vi.fn(() => ({
          type: '',
          frequency: { value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
          connect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null as any,
        })),
      };
      AudioStore.actx = mockCtx as any;
      AudioStore.master = {} as any;
      AudioStore.wetBus = null;

      playBoom(12, 0, { ignoreOptionsGuard: true });

      expect(delays.length).toBe(2);
      const spec = boomEchoSpec(12, false);
      expect(delays[0].delayTime.setValueAtTime).toHaveBeenCalledWith(spec.left, expect.any(Number));
      expect(delays[1].delayTime.setValueAtTime).toHaveBeenCalledWith(spec.right, expect.any(Number));
      // Each delay feeds onward rather than terminating at the output.
      expect(delays[0].connect).toHaveBeenCalled();
      expect(delays[1].connect).toHaveBeenCalled();
    });
  });
  describe('magnet lock levels', () => {
    const TIERS = [3, 7, 12, 18, 25];

    it('grows weight and length with the group the lock closed', () => {
      let prev = getMagnetLockProps(0);
      for (const n of TIERS.slice(1)) {
        const next = getMagnetLockProps(n);
        expect(next.dur).toBeGreaterThan(prev.dur);
        expect(next.vol).toBeGreaterThan(prev.vol);
        expect(next.sub).toBeGreaterThan(prev.sub);
        expect(next.drive).toBeGreaterThan(prev.drive);
        prev = next;
      }
    });

    it('steps on the same five tiers as the boom voice', () => {
      // A lock and the boom that later takes the same group apart should be
      // heard on one scale, so the tier edges must agree.
      for (const edge of [5, 10, 15, 20]) {
        expect(getMagnetLockProps(edge)).not.toEqual(getMagnetLockProps(edge - 1));
        expect(getBoomProps(edge)).not.toEqual(getBoomProps(edge - 1));
        expect(getMagnetLockProps(edge)).toEqual(getMagnetLockProps(edge + 1));
      }
    });

    it('spreads duration dramatically across the tiers, not incrementally', () => {
      const smallest = getMagnetLockProps(0).dur;
      const largest = getMagnetLockProps(25).dur;
      // Length is what makes a big lock read as a big event. An earlier version
      // spanned only 0.18s to 0.38s and was far too timid at the top.
      expect(largest / smallest).toBeGreaterThanOrEqual(4);
      expect(largest).toBeGreaterThanOrEqual(1.0);
    });

    it('makes the rarest lock the biggest one, not the meekest', () => {
      // The black-on-black pair is rarer and pays double, so at every tier it
      // must run longer and louder than a single black, never shorter or
      // quieter — it was briefly both, which is what made it read as timid.
      expect(PAIR_DUR).toBeGreaterThan(1);
      expect(PAIR_VOL).toBeGreaterThan(1);
      for (const n of TIERS) {
        const l = getMagnetLockProps(n);
        expect(l.dur * PAIR_DUR).toBeGreaterThan(l.dur);
        expect(l.vol * PAIR_VOL).toBeGreaterThan(l.vol);
      }
    });

    it('lifts the pair by a clear interval, above its own suction sub', () => {
      // It was an octave until the family was found too shrill; a fifth still
      // makes a pair recognisable without putting its resonance at 10 kHz. The
      // guard is that the interval stays wide enough to hear, not its exact size.
      expect(PAIR_LIFT).toBeCloseTo(1.5, 5);
      expect(PAIR_LIFT).toBeGreaterThanOrEqual(1.4);
      // The sub follows, but less far, so the lock keeps weight underneath
      // instead of thinning into a whistle.
      expect(PAIR_SUB_LIFT).toBeGreaterThan(1);
      expect(PAIR_SUB_LIFT).toBeLessThan(PAIR_LIFT);
    });

    it('leaves pitch to the pair lift, so level and pair never collide', () => {
      // Level moves weight only. If it moved pitch, a big single-black lock and
      // a small black-pair lock would land on the same sound.
      const small = getMagnetLockProps(3);
      const big = getMagnetLockProps(25);
      expect(Object.keys(small).sort()).toEqual(['drive', 'dur', 'sub', 'vol']);
      expect(Object.keys(big).sort()).toEqual(['drive', 'dur', 'sub', 'vol']);
    });

    it('carries the level into the arc drive and the suction sub', () => {
      const modGains: any[] = [];
      const subRamps: number[] = [];
      function lock(groupSize: number) {
        modGains.length = 0;
        subRamps.length = 0;
        const mockCtx = {
          currentTime: 0,
          createGain: vi.fn(() => {
            const node = {
              gain: {
                value: 1,
                setValueAtTime: vi.fn((v: number) => { if (v > 5) modGains.push(v); }),
                linearRampToValueAtTime: vi.fn((v: number) => { subRamps.push(v); }),
                exponentialRampToValueAtTime: vi.fn(),
              },
              connect: vi.fn(),
            };
            return node;
          }),
          createBiquadFilter: vi.fn(() => ({
            type: '', Q: { value: 1 },
            frequency: { value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
            connect: vi.fn(),
          })),
          createOscillator: vi.fn(() => ({
            type: '',
            frequency: { value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
            connect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null as any,
          })),
          createBufferSource: vi.fn(() => ({
            buffer: null, loop: false, playbackRate: { value: 1 },
            connect: vi.fn(), start: vi.fn(), stop: vi.fn(),
          })),
          createStereoPanner: vi.fn(() => ({ pan: { value: 0 }, connect: vi.fn() })),
        };
        AudioStore.actx = mockCtx as any;
        AudioStore.master = {} as any;
        AudioStore.noiseBuf = {} as any;
        AudioStore.wetBus = null;
        AudioStore.activeVoices = 0;
        playMagneticElectricSound(0, { ignoreOptionsGuard: true, groupSize });
        return { drive: Math.max(...modGains), peakRamp: Math.max(...subRamps) };
      }

      const small = lock(3);
      const big = lock(25);
      // The FM index: how hard the arc bites.
      expect(big.drive / small.drive).toBeCloseTo(
        getMagnetLockProps(25).drive / getMagnetLockProps(3).drive, 4);
      expect(big.peakRamp).toBeGreaterThan(small.peakRamp);
    });
  });

  describe('white swoosh presence', () => {
    it('hits harder than the modes alone: an onset scrape above every bank', () => {
      const bandpassQs: number[] = [];
      const mockCtx = {
        currentTime: 0,
        createGain: vi.fn(() => ({
          gain: {
            value: 1, setValueAtTime: vi.fn(),
            linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(),
          },
          connect: vi.fn(),
        })),
        createBufferSource: vi.fn(() => ({
          buffer: null, loop: false, playbackRate: { value: 1 },
          connect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null as any,
        })),
        // One entry per filter: each schedules its frequency twice, at `now`
        // and again at `t`.
        createBiquadFilter: vi.fn(() => {
          let seen = false;
          const node = {
            type: '', Q: { value: 1 },
            frequency: {
              value: 0,
              setValueAtTime: vi.fn(() => {
                if (seen) return;
                seen = true;
                bandpassQs.push(node.Q.value);
              }),
              linearRampToValueAtTime: vi.fn(),
            },
            connect: vi.fn(),
          };
          return node;
        }),
        createOscillator: vi.fn(() => ({
          type: '',
          frequency: { value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
          connect: vi.fn(), start: vi.fn(), stop: vi.fn(),
        })),
        createStereoPanner: vi.fn(() => ({ pan: { value: 0 }, connect: vi.fn() })),
      };
      AudioStore.actx = mockCtx as any;
      AudioStore.noiseBuf = { duration: 2.0 } as any;
      AudioStore.master = {} as any;
      AudioStore.wetBus = null;
      AudioStore.thuds = 0;
      AudioStore.swooshAt = -9;

      playSwoosh(0, 0.8, { ignoreOptionsGuard: true, isWhite: true });

      // Two noise sources: the one driving the banks, and the onset scrape.
      expect(mockCtx.createBufferSource).toHaveBeenCalledTimes(2);
      // One broad filter among the narrow mode banks — that is the scrape.
      expect(bandpassQs.some((q) => q < 11)).toBe(true);
      expect(bandpassQs.filter((q) => q >= 11).length).toBe(SWOOSH_METAL_MODES.length * 2);
    });
  });
  describe('attract-screen booms', () => {
    /** Deterministic sampler over the whole [0,1) range. */
    function sample(profile: 'menu' | 'celebration', n = 4000) {
      const out: { boomSize: number; whiteBlack: boolean }[] = [];
      for (let i = 0; i < n; i++) {
        let k = 0;
        // A cycling generator, so tier choice, size-within-tier and the
        // white-black draw each see a spread of values.
        const rand = () => ((i * 7 + k++ * 13) % 1000) / 1000;
        out.push(pickGameBoom(profile, rand));
      }
      return out;
    }

    it('only ever picks chain sizes a real boom could have', () => {
      for (const profile of ['menu', 'celebration'] as const) {
        for (const boom of sample(profile)) {
          // MIN_BOOM is 2, and the harness has never built a group past 19;
          // the top tier is allowed a little headroom above that.
          expect(boom.boomSize).toBeGreaterThanOrEqual(2);
          expect(boom.boomSize).toBeLessThanOrEqual(26);
          expect(Number.isInteger(boom.boomSize)).toBe(true);
        }
      }
    });

    it('reaches every tier, so the menu is not stuck on the smallest boom', () => {
      // The bug this replaced: both screens called the boom voice with no chain
      // size, so every attract boom was tier 0 for the life of the app.
      const tiersHit = new Set(
        sample('menu').map((b) => JSON.stringify(getBoomProps(b.boomSize)))
      );
      expect(tiersHit.size).toBe(5);
    });

    it('keeps the menu small-heavy and the celebration big-heavy', () => {
      const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
      const menu = mean(sample('menu').map((b) => b.boomSize));
      const party = mean(sample('celebration').map((b) => b.boomSize));
      expect(party).toBeGreaterThan(menu);
      // The menu still leans on the shape the harness measures: small booms
      // dominate a real match (mean about 3.8 balls).
      expect(menu).toBeLessThan(party * 0.75);
    });

    it('keeps the white-on-black boom a garnish on both screens', () => {
      for (const profile of ['menu', 'celebration'] as const) {
        const rate = sample(profile).filter((b) => b.whiteBlack).length / 4000;
        expect(rate).toBeGreaterThan(0);
        expect(rate).toBeLessThan(0.5);
      }
    });

    it('caps how many booms may overlap, whatever the caller asks for', () => {
      let booms = 0;
      const mockCtx = {
        currentTime: 0,
        createGain: vi.fn(() => ({
          gain: {
            value: 1, setValueAtTime: vi.fn(),
            linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(),
          },
          connect: vi.fn(),
        })),
        createBiquadFilter: vi.fn(() => ({
          type: '', Q: { value: 1, setValueAtTime: vi.fn() },
          frequency: { value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
          connect: vi.fn(),
        })),
        createDynamicsCompressor: vi.fn(() => {
          booms++;
          return {
            threshold: { setValueAtTime: vi.fn() }, knee: { setValueAtTime: vi.fn() },
            ratio: { setValueAtTime: vi.fn() }, attack: { setValueAtTime: vi.fn() },
            release: { setValueAtTime: vi.fn() }, connect: vi.fn(),
          };
        }),
        createDelay: vi.fn(() => ({ delayTime: { setValueAtTime: vi.fn() }, connect: vi.fn() })),
        createStereoPanner: vi.fn(() => ({ pan: { setValueAtTime: vi.fn() }, connect: vi.fn() })),
        createOscillator: vi.fn(() => ({
          type: '',
          frequency: { value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
          connect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null as any,
        })),
      };
      AudioStore.actx = mockCtx as any;
      AudioStore.master = {} as any;
      AudioStore.wetBus = null;
      resetAttractBooms();

      // Ten in a row at the same instant: a runaway caller.
      for (let i = 0; i < 10; i++) playRandomGameBoom(0, 'celebration', { ignoreOptionsGuard: true });
      expect(booms).toBe(3);

      // Once the tails have run out, booms are allowed again.
      (mockCtx as any).currentTime = 30;
      playRandomGameBoom(0, 'celebration', { ignoreOptionsGuard: true });
      expect(booms).toBe(4);
    });
  });

  describe('every voice plays in A Hirajoshi', () => {
    /** Semitones from the nearest note of the scale, in any octave. */
    function offKey(f: number): number {
      const steps = [...SCALE_STEPS, 12];
      const semis = 12 * Math.log2(f / SCALE_ROOT);
      const within = semis - 12 * Math.floor(semis / 12);
      return Math.min(...steps.map(st => Math.abs(within - st)));
    }
    /**
     * In key, allowing for the ±BEAT/2 offset of a binaural pair and for the
     * harmonics of a scale note. A partial at ×2 or ×3 of a note is part of that
     * note's own sound, not a melody note of its own: the boom carries them so a
     * phone speaker, which reproduces almost nothing below ~500 Hz, still gets
     * the pitch of a dive whose fundamental it cannot move.
     */
    function inTune(f: number): boolean {
      return [f, f - BEAT / 2, f + BEAT / 2].some(g =>
        g > 0 && [1, 2, 3].some(partial => offKey(g / partial) < 1e-6));
    }

    /**
     * Play `fn` against a fake context and return every frequency any oscillator
     * was set to or ramped to. Filters and noise are timbre, not notes, and are
     * not recorded.
     */
    function oscillatorPitches(fn: () => void): number[] {
      const out: number[] = [];
      const param = (record: boolean) => ({
        value: 0,
        setValueAtTime: (v: number) => { if (record) out.push(v); },
        linearRampToValueAtTime: (v: number) => { if (record) out.push(v); },
        exponentialRampToValueAtTime: (v: number) => { if (record) out.push(v); },
        setTargetAtTime: () => {},
        cancelScheduledValues: () => {},
      });
      const node = (osc: boolean): any => new Proxy({}, {
        get(target: any, key: string) {
          if (key in target) return target[key];
          if (['connect', 'disconnect', 'start', 'stop'].includes(key)) return () => {};
          if (key === 'onended' || key === 'buffer' || key === 'type') return undefined;
          target[key] = param(osc && key === 'frequency');
          return target[key];
        },
        set(target: any, key: string, v: any) { target[key] = v; return true; },
      });
      const ctx: any = new Proxy({ currentTime: 0, sampleRate: 48000, state: 'running' }, {
        get(target: any, key: string) {
          if (key in target) return target[key];
          if (key === 'createOscillator') return () => node(true);
          if (key.startsWith('create')) return () => node(false);
          return undefined;
        },
      });
      Object.assign(AudioStore, {
        actx: ctx, master: node(false), wetBus: node(false), noiseBuf: {},
        activeVoices: 0, thuds: 0, swooshAt: -9, soundOn: true,
      });
      fn();
      return out;
    }

    const VOICES: Record<string, () => void> = {
      'boom (every tier)': () => { for (const n of [3, 7, 12, 18, 25]) playBoom(n, 0, { ignoreOptionsGuard: true }); },
      'launch swoosh': () => playSwoosh(0, 0.8, { ignoreOptionsGuard: true }),
      'white ball swoosh': () => playSwoosh(0, 0.8, { ignoreOptionsGuard: true, isWhite: true }),
      'countdown tick': () => { playCountdownTick({ ignoreOptionsGuard: true }); playCountdownTick({ isGo: true, ignoreOptionsGuard: true }); },
      'UI clicks': () => {
        for (const n of ['cancel', 'select', 'confirm'] as const) {
          resetUiSoundsForTesting(); setClickLockMs(0);
          playBinauralClick(clickHz(n), 0.16, 0, 'toggle', 1, true);
        }
        resetUiSoundsForTesting();
      },
    };

    for (const [voice, play] of Object.entries(VOICES)) {
      it(`plays only scale notes: ${voice}`, () => {
        const pitches = oscillatorPitches(play);
        expect(pitches.length, voice).toBeGreaterThan(0);
        for (const f of pitches) expect(inTune(f), `${voice}: ${f.toFixed(2)} Hz`).toBe(true);
      });
    }

    it('lands the black magnet lock on scale notes, single and pair', () => {
      for (const isPair of [false, true]) {
        const pitches = oscillatorPitches(() => playMagneticElectricSound(0, { ignoreOptionsGuard: true, isPair }));
        // `lockTone` scales the arc and its filters; the suction sub is
        // deliberately outside it, which is what lets turning the knob down
        // shift the voice's weight downward rather than only dulling it.
        const lift = (isPair ? PAIR_LIFT : 1) * AudioStore.lockTone;
        const subLift = isPair ? PAIR_SUB_LIFT : 1;
        // The FM modulator shapes the arc's timbre and is not a note; the
        // carrier and the suction sub are.
        for (const f of [2400 * lift, 450 * lift, 130 * subLift, 320 * subLift, 90 * subLift]) {
          expect(pitches).toContain(inKey(f));
        }
      }
    });

    it('cuts the boom low end at the knob, in two stages, after the compressor', () => {
      const filters: { type: string; freq: number }[] = [];
      const node: any = () => ({
        connect: () => {}, disconnect: () => {}, start: () => {}, stop: () => {},
        gain: { value: 0, setValueAtTime: () => {}, linearRampToValueAtTime: () => {}, exponentialRampToValueAtTime: () => {}, cancelScheduledValues: () => {} },
      });
      const filter = () => {
        const f: any = {
          type: '', Q: { value: 1, setValueAtTime: () => {} },
          frequency: { value: 0, setValueAtTime: (v: number) => { f.freq = v; }, linearRampToValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} },
          connect: () => {}, disconnect: () => {},
        };
        filters.push(f);
        return f;
      };
      const osc = () => ({ ...node(), type: '', frequency: { value: 0, setValueAtTime: () => {}, linearRampToValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} }, onended: null });
      const ctx: any = {
        currentTime: 0,
        createGain: node, createOscillator: osc, createBiquadFilter: filter,
        createDelay: () => ({ ...node(), delayTime: { setValueAtTime: () => {} } }),
        createStereoPanner: () => ({ ...node(), pan: { setValueAtTime: () => {} } }),
        createDynamicsCompressor: () => ({
          ...node(),
          threshold: { setValueAtTime: () => {} }, knee: { setValueAtTime: () => {} },
          ratio: { setValueAtTime: () => {} }, attack: { setValueAtTime: () => {} }, release: { setValueAtTime: () => {} },
        }),
      };
      AudioStore.actx = ctx;
      AudioStore.master = node();
      AudioStore.boomCut = 150;
      playBoom(12, 0, { ignoreOptionsGuard: true });

      const highpasses = filters.filter(f => f.type === 'highpass');
      expect(highpasses.length).toBe(2);
      for (const hp of highpasses) expect((hp as any).freq).toBe(150);
    });

    it('keeps the boom tiers distinct and rising', () => {
      const lands = [3, 7, 12, 18, 25].map(n => boomPitches(n).land);
      for (let i = 1; i < lands.length; i++) expect(lands[i]).toBeGreaterThan(lands[i - 1]);
      const lifted = [3, 7, 12, 18, 25].map(n => boomPitches(n, true).land);
      lifted.forEach((f, i) => expect(f).toBeGreaterThan(lands[i]));
    });

    it('plays the lock, peel and knock on the same root as everything else', () => {
      // A multiplier that is not a whole number of octaves transposes the whole
      // voice: the bond's ×2.5 played the scale from C#.
      for (const mul of [BOND_VOICE.mul, BREAK_VOICE.mul]) expect(Number.isInteger(Math.log2(mul)), String(mul)).toBe(true);
    });

    it('keeps cancel, select and confirm distinct and rising', () => {
      expect(clickHz('select')).toBeGreaterThan(clickHz('cancel'));
      expect(clickHz('confirm')).toBeGreaterThan(clickHz('select'));
    });
  });
});
