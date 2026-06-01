import { commandManager } from '../../state/commandManager';
export { commandManager };

import type { Command } from '../../state/commands/CommandManager';

export function UndoHistory() {
  return (
    <div className="text-xs">
      {commandManager.getHistory().map((command: Command) => (
        <button key={command.id} className="block w-full truncate text-left">{command.description}</button>
      ))}
    </div>
  );
}
