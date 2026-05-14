export interface Command {
  label: string;
  do(): void;
  undo(): void;
}

type Listener = (canUndo: boolean, canRedo: boolean) => void;

export class History {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private listeners = new Set<Listener>();
  private limit: number;

  constructor(limit = 200) {
    this.limit = limit;
  }

  /**
   * Execute a command and push it to the undo stack. Clears the redo stack.
   */
  execute(cmd: Command) {
    cmd.do();
    this.undoStack.push(cmd);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
    this.notify();
  }

  /**
   * Push an already-applied command onto the undo stack without re-running it.
   * Use this when the change has already been made by another system (e.g.,
   * TransformControls dragging — the user already moved the object).
   */
  push(cmd: Command) {
    this.undoStack.push(cmd);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
    this.notify();
  }

  undo(): boolean {
    const cmd = this.undoStack.pop();
    if (!cmd) return false;
    cmd.undo();
    this.redoStack.push(cmd);
    this.notify();
    return true;
  }

  redo(): boolean {
    const cmd = this.redoStack.pop();
    if (!cmd) return false;
    cmd.do();
    this.undoStack.push(cmd);
    this.notify();
    return true;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  clear() {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.notify();
  }

  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify() {
    for (const fn of this.listeners) fn(this.canUndo, this.canRedo);
  }
}
