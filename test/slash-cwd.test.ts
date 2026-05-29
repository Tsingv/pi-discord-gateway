import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RegisteredChannel } from '../src/types.js';

const {
  clearPendingMessagesMock,
  getChannelMock,
  registerChannelMock,
  rotateChannelSessionDirMock,
  setChannelCwdOverrideMock,
} = vi.hoisted(() => ({
  clearPendingMessagesMock: vi.fn(),
  getChannelMock: vi.fn(),
  registerChannelMock: vi.fn(),
  rotateChannelSessionDirMock: vi.fn(),
  setChannelCwdOverrideMock: vi.fn(),
}));

vi.mock('../src/db.js', () => ({
  clearPendingMessages: clearPendingMessagesMock,
  createDmChannel: vi.fn(),
  getChannel: getChannelMock,
  registerChannel: registerChannelMock,
  setChannelCwdOverride: setChannelCwdOverrideMock,
  clearChannelModelOverride: vi.fn(),
  setChannelModelOverride: vi.fn(),
  setChannelThinkingOverride: vi.fn(),
}));

vi.mock('../src/session/path.js', () => ({
  rotateChannelSessionDir: rotateChannelSessionDirMock,
}));

vi.mock('../src/agent/queue.js', () => ({
  abortChannelTask: vi.fn(),
  isChannelProcessing: vi.fn(() => false),
}));

vi.mock('../src/agent/invoke.js', () => ({
  getChannelSessionStatus: vi.fn(),
}));

vi.mock('../src/agent/model-catalog.js', () => ({
  autocompleteModels: vi.fn(() => []),
  isThinkingLevel: vi.fn(() => true),
  listAvailableModels: vi.fn(() => []),
  resolveModelReference: vi.fn(),
  resolveThinkingForModel: vi.fn(() => ({
    adjusted: false,
    effective: 'off',
    requested: 'off',
  })),
  toModelChoiceName: vi.fn(),
}));

const originalEnv = { ...process.env };
const CONFIG_ENV_KEYS = ['CHANNEL_POLICY', 'DISCORD_BOT_TOKEN', 'PIDG_CONFIG'];

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();

  for (const key of CONFIG_ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe('/pi cwd', () => {
  it('sets the channel cwd override and starts a fresh session', async () => {
    process.env.DISCORD_BOT_TOKEN = 'token';
    getChannelMock
      .mockReturnValueOnce(channel({ cwdOverride: '/old/project' }))
      .mockReturnValueOnce(channel({ cwdOverride: '/new/project' }));
    clearPendingMessagesMock.mockReturnValue(2);
    rotateChannelSessionDirMock.mockReturnValue('/archive/ch_123__archived');

    const { handleChatCommand } = await import('../src/discord/slash-commands.js');
    const interaction = createCwdInteraction('/new/project');

    await handleChatCommand(interaction as any);

    expect(setChannelCwdOverrideMock).toHaveBeenCalledWith('dc:123', '/new/project');
    expect(clearPendingMessagesMock).toHaveBeenCalledWith('dc:123');
    expect(rotateChannelSessionDirMock).toHaveBeenCalledWith('ch_123');
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Working directory set to /new/project'),
      }),
    );
  });

  it('bootstraps an open-policy guild channel before setting cwd', async () => {
    process.env.DISCORD_BOT_TOKEN = 'token';
    process.env.CHANNEL_POLICY = 'open-trigger';
    getChannelMock
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(channel({ requiresTrigger: true }))
      .mockReturnValueOnce(channel({ cwdOverride: '/srv/app', requiresTrigger: true }));
    clearPendingMessagesMock.mockReturnValue(0);
    rotateChannelSessionDirMock.mockReturnValue(undefined);

    const { handleChatCommand } = await import('../src/discord/slash-commands.js');
    const interaction = createCwdInteraction('/srv/app');

    await handleChatCommand(interaction as any);

    expect(registerChannelMock).toHaveBeenCalledWith(
      expect.objectContaining({
        jid: 'dc:123',
        folder: 'ch_123',
        requiresTrigger: true,
      }),
    );
    expect(setChannelCwdOverrideMock).toHaveBeenCalledWith('dc:123', '/srv/app');
  });
});

function channel(overrides: Partial<RegisteredChannel> = {}): RegisteredChannel {
  return {
    jid: 'dc:123',
    name: 'Guild #general',
    folder: 'ch_123',
    requiresTrigger: false,
    isMain: false,
    modelOverride: '',
    thinkingOverride: '',
    cwdOverride: '',
    parentJid: '',
    ...overrides,
  };
}

function createCwdInteraction(path: string) {
  return {
    channel: { name: 'general' },
    channelId: '123',
    commandName: 'pi',
    deferred: false,
    guild: { name: 'Guild' },
    inGuild: () => true,
    options: {
      getString: vi.fn(() => path),
      getSubcommand: vi.fn(() => 'cwd'),
    },
    replied: false,
    reply: vi.fn(),
    user: { id: 'user-1', username: 'Alice' },
  };
}
