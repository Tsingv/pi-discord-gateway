import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RegisteredChannel } from '../src/types.js';

const {
  enqueueMessageMock,
  fakeClientInstances,
  getChannelMock,
  registerChannelMock,
  registerGlobalCommandsMock,
} = vi.hoisted(() => ({
  enqueueMessageMock: vi.fn(),
  fakeClientInstances: [] as FakeClient[],
  getChannelMock: vi.fn(),
  registerChannelMock: vi.fn(),
  registerGlobalCommandsMock: vi.fn(),
}));

class FakeClient extends EventEmitter {
  user = { id: 'bot-id', tag: 'PiBot#0001' };

  constructor() {
    super();
    fakeClientInstances.push(this);
  }

  login(): Promise<void> {
    queueMicrotask(() => this.emit('ready', this));
    return Promise.resolve();
  }
}

vi.mock('discord.js', () => ({
  ChannelType: { PrivateThread: 12 },
  Client: FakeClient,
  Events: {
    ClientReady: 'ready',
    Error: 'error',
    InteractionCreate: 'interactionCreate',
    MessageCreate: 'messageCreate',
  },
  GatewayIntentBits: {
    DirectMessages: 1,
    GuildMessages: 2,
    Guilds: 4,
    MessageContent: 8,
  },
  Partials: { Channel: 1 },
}));

vi.mock('../src/db.js', () => ({
  createDmChannel: vi.fn(),
  enqueueMessage: enqueueMessageMock,
  getChannel: getChannelMock,
  registerChannel: registerChannelMock,
}));

vi.mock('../src/discord/slash-commands.js', () => ({
  handleAutocomplete: vi.fn(),
  handleChatCommand: vi.fn(),
  registerGlobalCommands: registerGlobalCommandsMock,
}));

const originalEnv = { ...process.env };
const CONFIG_ENV_KEYS = ['CHANNEL_POLICY', 'DISCORD_BOT_TOKEN', 'PIDG_CONFIG'];

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  fakeClientInstances.length = 0;

  for (const key of CONFIG_ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe('Discord mention trigger', () => {
  it('requires an actual Discord mention for trigger-only channels', async () => {
    process.env.DISCORD_BOT_TOKEN = 'token';
    getChannelMock.mockReturnValue(triggerOnlyChannel({ cwdOverride: '/srv/app' }));

    const { startDiscord } = await import('../src/discord/client.js');
    await startDiscord();
    const fakeClient = fakeClientInstances[0];

    fakeClient.emit('messageCreate', createMessage('@pi hello'));
    await flushAsyncHandlers();
    expect(enqueueMessageMock).not.toHaveBeenCalled();

    fakeClient.emit('messageCreate', createMessage('<@bot-id> hello', true));
    await flushAsyncHandlers();
    expect(enqueueMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        channelJid: 'dc:thread-1',
        content: 'hello',
      }),
    );
    expect(registerChannelMock).toHaveBeenCalledWith(
      expect.objectContaining({
        jid: 'dc:thread-1',
        name: 'guild #general / pi-hello',
        folder: 'thread_thread-1',
        requiresTrigger: false,
        cwdOverride: '/srv/app',
        parentJid: 'dc:channel-1',
      }),
    );
  });

  it('continues directly inside an existing thread', async () => {
    process.env.DISCORD_BOT_TOKEN = 'token';
    getChannelMock.mockReturnValue({
      ...triggerOnlyChannel(),
      jid: 'dc:thread-1',
      folder: 'thread_thread-1',
      requiresTrigger: false,
      parentJid: 'dc:channel-1',
    });

    const { startDiscord } = await import('../src/discord/client.js');
    await startDiscord();
    const fakeClient = fakeClientInstances[0];

    fakeClient.emit('messageCreate', createMessage('next question', false, { thread: true }));
    await flushAsyncHandlers();

    expect(registerChannelMock).not.toHaveBeenCalled();
    expect(enqueueMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        channelJid: 'dc:thread-1',
        content: 'next question',
      }),
    );
  });

  it('falls back to sender name when the mention has no prompt text', async () => {
    process.env.DISCORD_BOT_TOKEN = 'token';
    getChannelMock.mockReturnValue(triggerOnlyChannel());

    const { startDiscord } = await import('../src/discord/client.js');
    await startDiscord();
    const fakeClient = fakeClientInstances[0];

    fakeClient.emit('messageCreate', createMessage('<@bot-id>   ', true));
    await flushAsyncHandlers();

    expect(registerChannelMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'guild #general / pi-Alice',
      }),
    );
  });
});

function triggerOnlyChannel(overrides: Partial<RegisteredChannel> = {}): RegisteredChannel {
  return {
    jid: 'dc:channel-1',
    name: 'guild #general',
    folder: 'ch_channel-1',
    requiresTrigger: true,
    isMain: false,
    modelOverride: '',
    thinkingOverride: '',
    cwdOverride: '',
    parentJid: '',
    ...overrides,
  };
}

function createMessage(content: string, mentioned = false, options?: { thread?: boolean }) {
  const thread = {
    id: 'thread-1',
    members: { add: vi.fn().mockResolvedValue('user-1') },
    name: content.replace(/<@!?bot-id>/g, '').trim()
      ? `pi-${content.replace(/<@!?bot-id>/g, '').trim()}`
      : 'pi-Alice',
  };
  const channel = options?.thread
    ? {
        id: 'thread-1',
        isThread: () => true,
        name: 'pi-Alice',
      }
    : {
        id: 'channel-1',
        isThread: () => false,
        name: 'general',
        threads: {
          create: vi.fn().mockResolvedValue(thread),
        },
      };

  return {
    attachments: { size: 0, values: () => [][Symbol.iterator]() },
    author: {
      bot: false,
      displayName: 'Alice',
      id: 'user-1',
      username: 'alice',
    },
    channel,
    channelId: options?.thread ? 'thread-1' : 'channel-1',
    content,
    createdAt: new Date('2026-05-29T00:00:00.000Z'),
    guild: { name: 'Guild' },
    member: { displayName: 'Alice' },
    mentions: { users: { has: () => mentioned } },
  };
}

async function flushAsyncHandlers(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}
