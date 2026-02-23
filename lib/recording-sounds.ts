/**
 * Short audio tones for recording start/stop feedback.
 *
 * We generate tones as tiny base64-encoded WAV files so there are no asset
 * files to manage.  Each WAV is ~0.15 s (mono 22050 Hz, 16-bit PCM).
 *
 * Start tone : two ascending beeps  (880 Hz → 1320 Hz)
 * Stop  tone : one descending beep  (880 Hz → 440 Hz)
 */

import { Audio } from 'expo-av';
import { Platform } from 'react-native';

// ---------------------------------------------------------------------------
// WAV helpers
// ---------------------------------------------------------------------------

function floatTo16Bit(sample: number): number {
    const clamped = Math.max(-1, Math.min(1, sample));
    return clamped < 0 ? clamped * 32768 : clamped * 32767;
}

function buildWav(samples: Float32Array, sampleRate: number = 22050): ArrayBuffer {
    const numSamples = samples.length;
    const bytesPerSample = 2; // 16-bit
    const dataSize = numSamples * bytesPerSample;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    const write = (offset: number, val: number, byteLen: number, littleEndian = true) =>
        littleEndian
            ? byteLen === 4 ? view.setUint32(offset, val, true) : view.setUint16(offset, val, true)
            : undefined;

    // RIFF header
    'RIFF'.split('').forEach((c, i) => view.setUint8(i, c.charCodeAt(0)));
    write(4, 36 + dataSize, 4);
    'WAVE'.split('').forEach((c, i) => view.setUint8(8 + i, c.charCodeAt(0)));

    // fmt chunk
    'fmt '.split('').forEach((c, i) => view.setUint8(12 + i, c.charCodeAt(0)));
    write(16, 16, 4);          // chunk size
    write(20, 1, 2);           // PCM format
    write(22, 1, 2);           // mono
    write(24, sampleRate, 4);  // sample rate
    write(28, sampleRate * bytesPerSample, 4); // byte rate
    write(32, bytesPerSample, 2); // block align
    write(34, 16, 2);          // bits per sample

    // data chunk
    'data'.split('').forEach((c, i) => view.setUint8(36 + i, c.charCodeAt(0)));
    write(40, dataSize, 4);

    for (let i = 0; i < numSamples; i++) {
        view.setInt16(44 + i * 2, floatTo16Bit(samples[i]), true);
    }

    return buffer;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    // Use btoa if available (web + RN via JSC/Hermes global)
    if (typeof btoa !== 'undefined') return btoa(binary);
    // Fallback: Buffer (Node / older Hermes)
    return Buffer.from(binary, 'binary').toString('base64');
}

/** Generate a tone that linearly sweeps from freqStart → freqEnd over durationSec */
function generateSweep(
    freqStart: number,
    freqEnd: number,
    durationSec: number,
    sampleRate: number = 22050,
    amplitude: number = 0.35,
): Float32Array {
    const n = Math.round(durationSec * sampleRate);
    const samples = new Float32Array(n);
    // Short fade-in / fade-out to avoid clicks
    const fadeLen = Math.round(0.01 * sampleRate); // 10 ms
    let phase = 0;
    for (let i = 0; i < n; i++) {
        const t = i / sampleRate;
        const freq = freqStart + (freqEnd - freqStart) * (i / n);
        phase += (2 * Math.PI * freq) / sampleRate;
        let env = amplitude;
        if (i < fadeLen) env *= i / fadeLen;
        else if (i > n - fadeLen) env *= (n - i) / fadeLen;
        samples[i] = Math.sin(phase) * env;
    }
    return samples;
}

function concat(...arrays: Float32Array[]): Float32Array {
    const totalLen = arrays.reduce((s, a) => s + a.length, 0);
    const out = new Float32Array(totalLen);
    let offset = 0;
    for (const a of arrays) { out.set(a, offset); offset += a.length; }
    return out;
}

// ---------------------------------------------------------------------------
// Pre-build the WAV data URIs once
// ---------------------------------------------------------------------------

const SR = 22050;

// Start: short silence + ascending double-chirp (440→880, gap, 880→1320)
const startSamples = concat(
    new Float32Array(Math.round(0.03 * SR)), // 30 ms silence
    generateSweep(440, 880, 0.08, SR, 0.4),  // first chirp
    new Float32Array(Math.round(0.04 * SR)), // 40 ms gap
    generateSweep(880, 1320, 0.10, SR, 0.45), // second, higher chirp
    new Float32Array(Math.round(0.03 * SR)), // trailing silence
);

// Stop: descending tone (880 → 440) — slightly longer, lower amplitude
const stopSamples = concat(
    new Float32Array(Math.round(0.02 * SR)),
    generateSweep(880, 440, 0.18, SR, 0.4),
    new Float32Array(Math.round(0.02 * SR)),
);

const startWavBase64 = arrayBufferToBase64(buildWav(startSamples, SR));
const stopWavBase64 = arrayBufferToBase64(buildWav(stopSamples, SR));

// data-URI that expo-av can load from memory (no file-system needed)
const startUri = `data:audio/wav;base64,${startWavBase64}`;
const stopUri = `data:audio/wav;base64,${stopWavBase64}`;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

let _startSound: Audio.Sound | null = null;
let _stopSound: Audio.Sound | null = null;

async function ensureSounds() {
    if (!_startSound) {
        const { sound } = await Audio.Sound.createAsync({ uri: startUri }, { volume: 1.0 });
        _startSound = sound;
    }
    if (!_stopSound) {
        const { sound } = await Audio.Sound.createAsync({ uri: stopUri }, { volume: 1.0 });
        _stopSound = sound;
    }
}

/** Play the "recording started" ascending chirp */
export async function playRecordingStart(): Promise<void> {
    if (Platform.OS === 'web') return;
    try {
        await Audio.setAudioModeAsync({ playsInSilentModeIOS: true, allowsRecordingIOS: false });
        await ensureSounds();
        await _startSound!.setPositionAsync(0);
        await _startSound!.playAsync();
    } catch (e) {
        console.warn('[RecordingSounds] playRecordingStart failed:', e);
    }
}

/** Play the "recording stopped" descending tone */
export async function playRecordingStop(): Promise<void> {
    if (Platform.OS === 'web') return;
    try {
        await Audio.setAudioModeAsync({ playsInSilentModeIOS: true, allowsRecordingIOS: false });
        await ensureSounds();
        await _stopSound!.setPositionAsync(0);
        await _stopSound!.playAsync();
    } catch (e) {
        console.warn('[RecordingSounds] playRecordingStop failed:', e);
    }
}

/** Unload sounds when no longer needed (call on app foreground→background) */
export async function unloadRecordingSounds(): Promise<void> {
    if (_startSound) { await _startSound.unloadAsync(); _startSound = null; }
    if (_stopSound) { await _stopSound.unloadAsync(); _stopSound = null; }
}
