import { describe, expect, test } from 'bun:test';
import { yap } from './engines/yap';
import { engineFor, toMarkdown } from './transcribe';

describe('engineFor', () => {
  test('macOS uses yap', () => {
    expect(engineFor('darwin')).toBe(yap);
  });

  test('a platform without an engine fails with a clear message', () => {
    expect(() => engineFor('win32')).toThrow("Transcription isn't supported on win32 yet");
  });
});

describe('toMarkdown', () => {
  test('writes one timestamped line per segment', () => {
    const markdown = toMarkdown({
      engine: 'yap',
      language: 'en-US',
      duration: 75,
      segments: [
        { start: 0.4, end: 3, text: 'Open the checkout page.' },
        { start: 59.6, end: 62, text: 'Tap pay.' },
        { start: 73.2, end: 75, text: 'The total shows zero.' }
      ]
    });
    expect(markdown).toBe('[00:00] Open the checkout page.\n[00:59] Tap pay.\n[01:13] The total shows zero.\n');
  });
});
