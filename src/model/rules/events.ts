/**
 * Placeholder for the concrete domain event union. Commit 3 will
 * replace this with the discriminated union of tmux pane / window /
 * session / controller events.
 */
export type DomainEvent = unknown;

export interface EventBus {
  emit(event: DomainEvent): void;
  subscribe(handler: (event: DomainEvent) => void): () => void;
}