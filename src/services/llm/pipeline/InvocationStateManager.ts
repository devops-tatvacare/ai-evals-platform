/**
 * Invocation State Manager
 * Observable state for UI progress tracking
 */

import type { InvocationState } from './types';

export class InvocationStateManager {
  private currentState: InvocationState | null = null;
  private listeners: Array<(state: InvocationState) => void> = [];
  
  setState(state: InvocationState): void {
    this.currentState = state;
    
    // Emit to all listeners
    this.listeners.forEach(listener => {
      try {
        listener(state);
      } catch (error) {
        console.error('[StateManager] Listener error:', error);
      }
    });
    
    // Log state changes
    console.log('[LLMPipeline]', state);
  }
  
  subscribe(listener: (state: InvocationState) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index > -1) this.listeners.splice(index, 1);
    };
  }
  
  getState(): InvocationState | null {
    return this.currentState;
  }
  
  reset(): void {
    this.currentState = null;
    this.listeners = [];
  }
}
