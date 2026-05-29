import { describe, expect, it } from 'vitest';
import { buildChannelSessionId, validateSessionFolder } from '../src/session/path.js';

describe('validateSessionFolder', () => {
  it('accepts valid relative folder names', () => {
    expect(validateSessionFolder('channel-123')).toBe('channel-123');
    expect(validateSessionFolder('guild/general')).toBe('guild/general');
    expect(validateSessionFolder('team/project/channel')).toBe('team/project/channel');
  });

  it('rejects empty, absolute, and dot-segment paths', () => {
    expect(() => validateSessionFolder('   ')).toThrow('Session folder cannot be empty');
    expect(() => validateSessionFolder('/tmp/channel')).toThrow('Session folder must be relative');
    expect(() => validateSessionFolder('../channel')).toThrow(
      'Session folder contains an invalid path segment',
    );
    expect(() => validateSessionFolder('guild/./channel')).toThrow(
      'Session folder contains an invalid path segment',
    );
    expect(() => validateSessionFolder('guild/../channel')).toThrow(
      'Session folder contains an invalid path segment',
    );
  });
});

describe('buildChannelSessionId', () => {
  it('builds stable pi session ids from channel folders', () => {
    expect(buildChannelSessionId('thread_123')).toMatch(/^piscord-thread_123-[a-f0-9]{12}$/u);
    expect(buildChannelSessionId('guild/general')).toMatch(
      /^piscord-guild\.general-[a-f0-9]{12}$/u,
    );
    expect(buildChannelSessionId('guild/general')).toBe(buildChannelSessionId('guild/general'));
  });
});
