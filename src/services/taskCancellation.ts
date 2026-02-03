/**
 * Task Cancellation Registry
 * Maintains a registry of active tasks and their cancellation callbacks
 */

type CancelCallback = () => void;

class TaskCancellationRegistry {
  private registry = new Map<string, CancelCallback>();

  register(taskId: string, cancelFn: CancelCallback): void {
    this.registry.set(taskId, cancelFn);
  }

  unregister(taskId: string): void {
    this.registry.delete(taskId);
  }

  cancel(taskId: string): boolean {
    const cancelFn = this.registry.get(taskId);
    if (cancelFn) {
      cancelFn();
      this.unregister(taskId);
      return true;
    }
    return false;
  }

  has(taskId: string): boolean {
    return this.registry.has(taskId);
  }
}

export const taskCancellationRegistry = new TaskCancellationRegistry();
