import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { execSyncMock, spawnMock } = vi.hoisted(() => ({
  execSyncMock: vi.fn(),
  spawnMock: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execSync: execSyncMock,
  spawn: spawnMock,
}));

const originalEnv = { ...process.env };
const tempDirs: string[] = [];
const CONFIG_ENV_KEYS = [
  'DB_PATH',
  'PIDG_CONFIG',
  'PI_BIN',
  'PI_CWD',
  'PI_EXTRA_FLAGS',
  'PI_MODEL',
  'PI_SPAWN_MODE',
  'PI_THINKING',
  'SESSIONS_DIR',
];

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

  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('invokeAgent spawn mode', () => {
  it('spawns pi directly by default', async () => {
    const tempDir = configureInvokeEnv({ spawnMode: undefined, piBin: '/usr/local/bin/pi' });
    spawnMock.mockImplementation(() => createSuccessfulProcess('direct response'));

    const { invokeAgent } = await import('../src/agent/invoke.js');
    await expect(invokeAgent('guild/general', 'hello world')).resolves.toMatchObject({
      ok: true,
      text: 'direct response',
    });

    expect(spawnMock).toHaveBeenCalledWith(
      '/usr/local/bin/pi',
      [
        '--session-dir',
        resolve(tempDir, 'sessions/guild/general'),
        '--continue',
        '-p',
        'hello world',
      ],
      expect.objectContaining({
        cwd: resolve(tempDir, 'work project'),
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    );
  });

  it('runs pi through bash login shell when configured', async () => {
    const tempDir = configureInvokeEnv({
      spawnMode: 'bash',
      piBin: '/opt/pi bin/pi',
    });
    spawnMock.mockImplementation(() => createSuccessfulProcess('bash response'));

    const { invokeAgent } = await import('../src/agent/invoke.js');
    await expect(invokeAgent('guild/general', "hello 'quoted' world")).resolves.toMatchObject({
      ok: true,
      text: 'bash response',
    });

    const expectedSessionDir = resolve(tempDir, 'sessions/guild/general');
    expect(spawnMock).toHaveBeenCalledWith(
      'bash',
      [
        '-lic',
        [
          "'/opt/pi bin/pi'",
          "'--session-dir'",
          `'${expectedSessionDir}'`,
          "'--continue'",
          "'-p'",
          "'hello '\\''quoted'\\'' world'",
        ].join(' '),
      ],
      expect.objectContaining({
        cwd: resolve(tempDir, 'work project'),
      }),
    );
  });

  it('runs pi through zsh login shell when configured', async () => {
    configureInvokeEnv({ spawnMode: 'zsh', piBin: 'pi' });
    spawnMock.mockImplementation(() => createSuccessfulProcess('zsh response'));

    const { invokeAgent } = await import('../src/agent/invoke.js');
    await expect(invokeAgent('guild/general', 'hello')).resolves.toMatchObject({
      ok: true,
      text: 'zsh response',
    });

    const [bin, args] = spawnMock.mock.calls[0] ?? [];
    expect(bin).toBe('zsh');
    expect(args).toEqual(['-lic', expect.stringContaining("'pi'")]);
  });
});

function configureInvokeEnv(options: {
  spawnMode?: 'bash' | 'zsh';
  piBin: string;
  extraFlags?: string;
}): string {
  const tempDir = mkdtempSync(join(tmpdir(), 'pidg-invoke-'));
  tempDirs.push(tempDir);

  process.env.PIDG_CONFIG = resolve(tempDir, 'missing-config.env');
  process.env.DB_PATH = resolve(tempDir, 'gateway.db');
  process.env.SESSIONS_DIR = resolve(tempDir, 'sessions');
  process.env.PI_BIN = options.piBin;
  process.env.PI_CWD = resolve(tempDir, 'work project');
  process.env.PI_EXTRA_FLAGS = options.extraFlags ?? '';
  delete process.env.PI_MODEL;
  delete process.env.PI_THINKING;

  if (options.spawnMode) {
    process.env.PI_SPAWN_MODE = options.spawnMode;
  } else {
    delete process.env.PI_SPAWN_MODE;
  }

  return tempDir;
}

function createSuccessfulProcess(stdout: string): EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
} {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };

  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn();

  queueMicrotask(() => {
    proc.stdout.emit('data', Buffer.from(stdout));
    proc.emit('close', 0);
  });

  return proc;
}
