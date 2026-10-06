# MP3 duration fixtures

These files contain a generated mono 440 Hz sine wave, with no recorded speech or personal data. Created on 2026-10-06 with lamejs 1.2.1 at 44100 Hz (128 kbps), 22050 Hz (64 kbps) and 11025 Hz (64 kbps). One second of input PCM plus encoder padding produces longer encoded durations.

macOS `/usr/bin/afinfo` independently reported estimated durations of 1.044875, 1.071000 and 1.149375 seconds, respectively. Tests permit two milliseconds of estimate/rounding difference and stream the full frames with single-byte and 13-byte boundaries. The production verifier counts encoded frame duration, including encoder padding; it does not decode PCM or prove compatibility with physical PLAUD exports.
