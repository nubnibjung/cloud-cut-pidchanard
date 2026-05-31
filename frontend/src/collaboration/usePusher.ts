import Pusher, { type Channel } from 'pusher-js';
import { useEffect, useRef } from 'react';
import { useAuthStore } from '../state/authStore';

const PUSHER_KEY = import.meta.env.VITE_PUSHER_KEY ?? '';
const PUSHER_CLUSTER = import.meta.env.VITE_PUSHER_CLUSTER ?? 'mt1';
const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8080';

let pusherInstance: Pusher | null = null;

function getPusher(): Pusher | null {
  if (!PUSHER_KEY) return null;
  if (!pusherInstance) {
    pusherInstance = new Pusher(PUSHER_KEY, {
      cluster: PUSHER_CLUSTER,
      authEndpoint: `${API_BASE}/pusher/auth`,
      auth: {
        headers: { Authorization: `Bearer ${useAuthStore.getState().token ?? ''}` },
      },
    });
  }
  return pusherInstance;
}

export function usePusher(
  projectId: string | null,
  onOperation: (event: string, payload: unknown) => void,
) {
  const channelRef = useRef<Channel | null>(null);
  const callbackRef = useRef(onOperation);
  callbackRef.current = onOperation;

  useEffect(() => {
    if (!projectId) return;
    const pusher = getPusher();
    if (!pusher) {
      // No Pusher credentials: log and skip
      console.debug('[Pusher] Not configured, real-time sync disabled');
      return;
    }

    const channel = pusher.subscribe(`private-project-${projectId}`);
    channelRef.current = channel;

    const events = [
      'clip-added', 'clip-updated', 'clip-deleted',
      'track-updated', 'effect-updated', 'transition-updated',
      'text-overlay-updated',
    ];

    for (const event of events) {
      channel.bind(event, (data: unknown) => {
        callbackRef.current(event, data);
      });
    }

    return () => {
      channel.unbind_all();
      pusher.unsubscribe(`private-project-${projectId}`);
      channelRef.current = null;
    };
  }, [projectId]);
}
