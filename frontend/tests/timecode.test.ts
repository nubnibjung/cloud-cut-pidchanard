import { describe, expect, it } from 'vitest';
import { formatTimecode, msToPixels, pixelsToMs } from '../src/utils/timecode';

describe('timecode utilities', () => {
  it('formats milliseconds as timecode', () => {
    expect(formatTimecode(1000)).toBe('00:00:01:00');
  });

  it('converts between milliseconds and pixels', () => {
    expect(pixelsToMs(msToPixels(5000, 10), 10)).toBe(5000);
  });
});
