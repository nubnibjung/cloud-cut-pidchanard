export interface Collaborator {
  userId: string;
  name: string;
}

export function usePresence(): Collaborator[] {
  return [{ userId: 'alice', name: 'Alice' }, { userId: 'bob', name: 'Bob' }];
}
