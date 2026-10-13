# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy"]
# ///
"""Generate a quiet original tonal bed; no licensed music or external recordings."""
from pathlib import Path
import wave
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
RATE = 24000
DURATION = 32
samples = np.zeros(RATE * DURATION)


def note(start, frequency, duration, gain):
    count = int(duration * RATE)
    t = np.arange(count) / RATE
    attack = np.minimum(1, t / .055)
    release = np.minimum(1, (duration - t) / .5)
    tone = (np.sin(2 * np.pi * frequency * t) + .16 * np.sin(4 * np.pi * frequency * t))
    tone *= np.exp(-t / 1.7) * attack * release * gain
    first = int(start * RATE)
    available = min(count, len(samples) - first)
    samples[first:first + available] += tone[:available]


for bar, chord in enumerate([(146.83,220.,293.66),(130.81,196.,261.63),(98.,146.83,246.94),(110.,164.81,220.)]):
    for i in range(8):
        note(bar * 8 + i, chord[i % 3] * (2 if i % 4 == 2 else 1), 3.5, .09)
    note(bar * 8, chord[0] / 2, 7, .07)
samples *= np.minimum(1, np.arange(len(samples)) / (RATE * 1.5))
samples *= np.minimum(1, (len(samples) - np.arange(len(samples))) / (RATE * 1.5))
target=ROOT / 'public/sound/bed.wav'
target.parent.mkdir(parents=True, exist_ok=True)
with wave.open(str(target), 'wb') as output:
    output.setnchannels(1)
    output.setsampwidth(2)
    output.setframerate(RATE)
    output.writeframes((np.clip(samples,-1,1)*32767).astype('<i2').tobytes())
print('Generated original 32-second sound bed')
