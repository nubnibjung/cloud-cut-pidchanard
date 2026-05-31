import { useCallback, useEffect, useRef } from 'react';
import { api } from '../services/api';
import { useProjectStore } from '../state/projectStore';
import { usePusher } from './usePusher';

interface OperationDto {
  id: string;
  project_id: string;
  user_id: string;
  operation_type: string;
  payload: unknown;
  server_seq: number;
}

export function useOperationSync(projectId: string | null) {
  const lastSeqRef = useRef<number>(0);
  const applyRemoteOperation = useProjectStore((state) => state.applyRemoteOperation);

  const catchUp = useCallback(async () => {
    if (!projectId) return;
    try {
      const ops = await api<OperationDto[]>(
        `/projects/${projectId}/operations?afterSeq=${lastSeqRef.current}`,
      );
      for (const op of ops) {
        applyRemoteOperation({ type: op.operation_type, payload: op.payload });
        lastSeqRef.current = Math.max(lastSeqRef.current, op.server_seq);
      }
    } catch {
      // Offline or no ops — ignore
    }
  }, [projectId, applyRemoteOperation]);

  useEffect(() => {
    catchUp();
  }, [catchUp]);

  const handlePusherEvent = useCallback(
    (event: string, data: unknown) => {
      const payload = data as Record<string, unknown>;
      if (typeof payload.serverSeq === 'number') {
        lastSeqRef.current = Math.max(lastSeqRef.current, payload.serverSeq);
      }
      applyRemoteOperation({ type: event, payload: data });
    },
    [applyRemoteOperation],
  );

  usePusher(projectId, handlePusherEvent);

  return { catchUp };
}
