import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  AudioStore, initAudio, sleepAudio, audioReturned, checkAudioOnGesture, isAudioAsleep,
  rebuildAudio, audioRebuilds, onAudioRebuild, RETURN_GRACE_MS,
} from '../../src/audio/SynthEngine';
import { playNote } from '../../src/audio/Voices';

/**
 * Coming back to the game could leave the sound on but silent until the player
 * switched it off and on (Chrome on Android). These drive a fake context through
 * leaving and coming back: asleep while out of view, woken on return, and
 * rebuilt on the first gesture if it is still not playing.
 */

/** A node that accepts every call and hands out AudioParams on demand. */
function fakeNode(): any {
  const param = () => ({
    value: 0, setValueAtTime: vi.fn(), setTargetAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(),
  });
  const params: Record<string, any> = {};
  return new Proxy({}, {
    get(target: any, key: string) {
      if (key in target) return target[key];
      if (['gain', 'frequency', 'Q', 'pan', 'threshold', 'knee', 'ratio', 'attack', 'release', 'delayTime', 'detune'].includes(key)) {
        return (params[key] ??= param());
      }
      return (target[key] = vi.fn());
    },
    set(target: any, key: string, v: any) { target[key] = v; return true; },
  });
}

class FakeContext {
  static made: FakeContext[] = [];
  state = 'running';
  currentTime = 0;
  sampleRate = 8000;
  destination = fakeNode();
  suspend = vi.fn(() => { this.state = 'suspended'; return Promise.resolve(); });
  resume = vi.fn(() => { this.state = 'running'; return Promise.resolve(); });
  close = vi.fn(() => { this.state = 'closed'; return Promise.resolve(); });
  constructor() { FakeContext.made.push(this); }
  createBuffer(_ch: number, len: number) { return { getChannelData: () => new Float32Array(len) }; }
  createGain() { return fakeNode(); }
  createOscillator() { return fakeNode(); }
  createBiquadFilter() { return fakeNode(); }
  createDynamicsCompressor() { return fakeNode(); }
  createConvolver() { return fakeNode(); }
  createStereoPanner() { return fakeNode(); }
  createBufferSource() { return fakeNode(); }
  createDelay() { return fakeNode(); }
  createWaveShaper() { return fakeNode(); }
}

let wall = 1000;
const saved = { ...AudioStore };

beforeEach(() => {
  FakeContext.made = [];
  (globalThis as any).window = { AudioContext: FakeContext };
  vi.spyOn(performance, 'now').mockImplementation(() => wall);
  Object.assign(AudioStore, { actx: null, master: null, wetBus: null, droneGain: null, droneOsc: null, noiseBuf: null, soundOn: true, latency: 0 });
  initAudio();
});

afterEach(() => {
  // Leave nothing asleep or half-returned for the next test.
  checkAudioOnGesture();
  Object.assign(AudioStore, saved);
  delete (globalThis as any).window;
  vi.restoreAllMocks();
});

const ctx = () => AudioStore.actx as unknown as FakeContext;

describe('leaving the page', () => {
  it('suspends the context and lets no voice start while out of view', () => {
    sleepAudio();
    expect(ctx().suspend).toHaveBeenCalledTimes(1);
    expect(isAudioAsleep()).toBe(true);
    const voicesBefore = AudioStore.activeVoices;
    playNote(0.5, 0, 'bond');
    expect(AudioStore.activeVoices).toBe(voicesBefore);
    // And the same note plays once the page is back.
    audioReturned();
    playNote(0.5, 0, 'bond');
    expect(AudioStore.activeVoices).toBe(voicesBefore + 1);
  });

  it('is not woken by a timer calling initAudio meanwhile', () => {
    sleepAudio();
    ctx().state = 'suspended';
    initAudio();
    expect(ctx().resume).not.toHaveBeenCalled();
  });
});

describe('coming back', () => {
  it('resumes, and a gesture once the clock is moving leaves the context as it is', async () => {
    sleepAudio();
    await Promise.resolve();
    audioReturned();
    expect(ctx().resume).toHaveBeenCalledTimes(1);
    expect(isAudioAsleep()).toBe(false);
    const first = ctx();
    first.currentTime += 0.3;
    wall += 400;
    checkAudioOnGesture();
    expect(ctx()).toBe(first);
    expect(first.close).not.toHaveBeenCalled();
  });

  it('retries the resume on a gesture inside the grace period, without rebuilding', () => {
    sleepAudio();
    audioReturned();
    ctx().state = 'suspended'; // the resume was refused
    ctx().resume.mockClear();
    wall += RETURN_GRACE_MS / 2;
    checkAudioOnGesture();
    expect(ctx().resume).toHaveBeenCalledTimes(1);
    expect(FakeContext.made).toHaveLength(1);
  });

  it('rebuilds a context still stopped after the grace period', () => {
    sleepAudio();
    audioReturned();
    const first = ctx();
    first.state = 'suspended';
    first.resume.mockImplementation(() => Promise.reject(new Error('not allowed')));
    wall += RETURN_GRACE_MS + 1;
    checkAudioOnGesture();
    expect(first.close).toHaveBeenCalled();
    expect(ctx()).not.toBe(first);
    expect(ctx().state).toBe('running');
  });

  it('rebuilds a context that says it is running while its clock stands still', () => {
    sleepAudio();
    audioReturned();
    const first = ctx();
    first.state = 'running';
    wall += RETURN_GRACE_MS + 1;
    checkAudioOnGesture();
    expect(ctx()).not.toBe(first);
  });

  it('treats a gesture while still asleep as the return it never heard about', () => {
    sleepAudio();
    checkAudioOnGesture();
    expect(isAudioAsleep()).toBe(false);
    expect(ctx().resume).toHaveBeenCalled();
  });
});

describe('rebuilding', () => {
  it('clears the counts and the clock readings the old context left behind', () => {
    const heard = vi.fn();
    onAudioRebuild(heard);
    const before = audioRebuilds();
    Object.assign(AudioStore, { activeVoices: 22, thuds: 10, cursor: 900, loadAt: 900, load: 3, thudAt: 900, swooshAt: 900 });
    rebuildAudio('test');
    expect(audioRebuilds()).toBe(before + 1);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(AudioStore).toMatchObject({ activeVoices: 0, thuds: 0, load: 0, loadAt: 0 });
    expect(AudioStore.cursor).toBeLessThan(0);
    expect(AudioStore.thudAt).toBeLessThan(0);
    expect(AudioStore.swooshAt).toBeLessThan(0);
  });

  it('is a no-op before audio has started', () => {
    AudioStore.actx = null;
    const before = audioRebuilds();
    rebuildAudio('test');
    expect(AudioStore.actx).toBeNull();
    expect(audioRebuilds()).toBe(before);
  });
});
