import { CommandManager } from '../../state/commands/CommandManager';

export const commandManager = new CommandManager();

export function UndoHistory() {
  return (
    <div className="text-xs">
      {commandManager.getHistory().map((command) => (
        <button key={command.id} className="block w-full truncate text-left">{command.description}</button>
      ))}
    </div>
  );
}
