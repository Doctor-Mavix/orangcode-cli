import { afterEach, describe, expect, it, vi } from 'vitest';

import { CliError } from '../errors';
import { buildRegistry } from './index';
import { CommandRegistry } from './registry';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CommandRegistry', () => {
  it('routes a known name to its command', () => {
    const registry = buildRegistry();

    expect(registry.resolve('validate').name).toBe('validate');
    expect(registry.resolve('help').name).toBe('help');
    expect(registry.resolve('version').name).toBe('version');
  });

  it('rejects a duplicate registration', () => {
    const registry = new CommandRegistry();
    const command = { name: 'noop', summary: 'Nothing.', run: () => 0 };

    registry.register(command);
    expect(() => {
      registry.register(command);
    }).toThrow(/registered twice/);
  });

  it('fails on an unknown command with a suggestion for a near miss', () => {
    const registry = buildRegistry();

    expect(() => registry.resolve('validat')).toThrow(CliError);
    expect(() => registry.resolve('validat')).toThrow(/Did you mean "validate"\?/);
    expect(() => registry.resolve('verison')).toThrow(/Did you mean "version"\?/);
  });

  it('fails on an unknown command without a far-fetched suggestion', () => {
    const registry = buildRegistry();

    expect(() => registry.resolve('frobnicate')).toThrow(/Unknown command "frobnicate"/);
    expect(() => registry.resolve('frobnicate')).toThrow(/orangcode help/);
    expect(() => registry.resolve('frobnicate')).not.toThrow(/Did you mean/);
  });
});

describe('help command', () => {
  it('lists every registered command with its summary', async () => {
    const lines: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      lines.push(String(chunk));
      return true;
    });

    const registry = buildRegistry();
    const code = await registry.resolve('help').run([]);
    const output = lines.join('');

    expect(code).toBe(0);
    for (const command of registry.list()) {
      expect(output).toContain(command.name);
      expect(output).toContain(command.summary);
    }
  });
});
