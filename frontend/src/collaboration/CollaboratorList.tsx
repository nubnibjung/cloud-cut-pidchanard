import { usePresence } from './usePresence';

export function CollaboratorList() {
  const collaborators = usePresence();
  return <div>{collaborators.map((user) => <span key={user.userId}>{user.name}</span>)}</div>;
}
