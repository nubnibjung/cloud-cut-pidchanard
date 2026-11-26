export interface Command {
  id: string;
  type: string;
  description: string;
  timestamp: number;
  execute(): void;
  undo(): void;
}

export class CommandManager {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private maxHistory = 50;
  private flushers: Array<() => void> = [];

  execute(command: Command): void {
    command.execute();
    this.record(command);
  }

  /** Adds a command whose effect has already been applied (e.g. a finished drag). */
  record(command: Command): void {
    this.undoStack = [...this.undoStack, command].slice(-this.maxHistory);
    this.redoStack = [];
  }

  /** Registers a callback that commits in-progress edits before undo/redo runs. */
  addFlusher(flush: () => void): void {
    this.flushers.push(flush);
  }

  private flush(): void {
    for (const flush of this.flushers) flush();
  }

  undo(): void {
    this.flush();
    const command = this.undoStack.pop();
    if (!command) return;
    command.undo();
    this.redoStack.push(command);
  }

  redo(): void {
    this.flush();
    const command = this.redoStack.pop();
    if (!command) return;
    command.execute();
    this.undoStack.push(command);
  }

  getHistory(): Command[] {
    return [...this.undoStack];
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }
}
