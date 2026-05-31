import { describe, expect, it } from 'vitest';
import { CommandManager } from '../src/state/commands/CommandManager';

describe('CommandManager', () => {
  it('executes and undoes commands', () => {
    let value = 0;
    const manager = new CommandManager();
    manager.execute({ id: '1', type: 'inc', description: 'Increment', timestamp: Date.now(), execute: () => value += 1, undo: () => value -= 1 });
    expect(value).toBe(1);
    manager.undo();
    expect(value).toBe(0);
    manager.redo();
    expect(value).toBe(1);
  });
});
