import { useEffect, useRef, useState } from 'react';
import type {
  AgentEventCursor,
  AgentEventEnvelope,
  RunState,
} from 'shared/types';
import { openLocalApiWebSocket } from '@/shared/lib/localApiTransport';
import {
  emptyCanonicalAgentTimeline,
  mergeCanonicalAgentTimeline,
  type CanonicalAgentTimeline,
} from './canonicalAgentTimeline';

type AgentRunStreamMessage =
  | { type: 'event'; data: { event: AgentEventEnvelope; replay: boolean } }
  | {
      type: 'ready';
      data: { state: RunState; cursor?: AgentEventCursor | null };
    }
  | {
      type: 'state';
      data: { state: RunState; cursor?: AgentEventCursor | null };
    }
  | { type: 'error'; data: { message: string } };

export interface UseAgentRunCanonicalStreamResult {
  timeline: CanonicalAgentTimeline | null;
  isConnected: boolean;
  isInitialized: boolean;
  error: string | null;
}

/**
 * Consume the canonical AgentRun stream. Reconnects resume from the last
 * attempt/sequence cursor; the reducer drops duplicate replay events.
 */
export function useAgentRunCanonicalStream(
  agentRunId: string | undefined,
  enabled = true
): UseAgentRunCanonicalStreamResult {
  const [timeline, setTimeline] = useState<CanonicalAgentTimeline | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timelineRef = useRef<CanonicalAgentTimeline | null>(null);
  const retryTimerRef = useRef<number | null>(null);
  const retryAttemptRef = useRef(0);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!enabled || !agentRunId) {
      socketRef.current?.close();
      socketRef.current = null;
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      timelineRef.current = null;
      setTimeline(null);
      setIsConnected(false);
      setIsInitialized(false);
      setError(null);
      return;
    }

    let cancelled = false;
    timelineRef.current = emptyCanonicalAgentTimeline();
    setTimeline(timelineRef.current);
    setIsInitialized(false);

    const scheduleReconnect = () => {
      if (cancelled || retryTimerRef.current !== null) return;
      const delay = Math.min(8_000, 500 * 2 ** retryAttemptRef.current);
      retryAttemptRef.current += 1;
      retryTimerRef.current = window.setTimeout(() => {
        retryTimerRef.current = null;
        void connect();
      }, delay);
    };

    const connect = async () => {
      const cursor = timelineRef.current?.cursor;
      const params = new URLSearchParams();
      if (cursor) {
        params.set('after_attempt_number', String(cursor.run_attempt_number));
        params.set('after_sequence', String(cursor.sequence));
      }
      const endpoint = `/api/agent-runs/${agentRunId}/events/ws${
        params.toString() ? `?${params.toString()}` : ''
      }`;

      try {
        const socket = await openLocalApiWebSocket(endpoint);
        if (cancelled) {
          socket.close();
          return;
        }
        socketRef.current = socket;
        socket.onopen = () => {
          retryAttemptRef.current = 0;
          setIsConnected(true);
          setError(null);
        };
        socket.onmessage = (message) => {
          try {
            const parsed = JSON.parse(message.data) as AgentRunStreamMessage;
            const current =
              timelineRef.current ?? emptyCanonicalAgentTimeline();
            let next = current;
            switch (parsed.type) {
              case 'event':
                next = mergeCanonicalAgentTimeline(current, [
                  parsed.data.event,
                ]);
                break;
              case 'ready':
              case 'state':
                next = mergeCanonicalAgentTimeline(
                  current,
                  [],
                  parsed.data.state,
                  parsed.data.cursor
                );
                break;
              case 'error':
                setError(parsed.data.message);
                return;
            }
            timelineRef.current = next;
            setTimeline(next);
            if (parsed.type === 'ready') setIsInitialized(true);
          } catch (parseError) {
            setError(
              parseError instanceof Error
                ? parseError.message
                : 'Invalid AgentRun event'
            );
          }
        };
        socket.onerror = () => {
          setError('AgentRun stream connection failed');
        };
        socket.onclose = () => {
          socketRef.current = null;
          setIsConnected(false);
          scheduleReconnect();
        };
      } catch (connectError) {
        setIsConnected(false);
        setError(
          connectError instanceof Error
            ? connectError.message
            : 'AgentRun stream unavailable'
        );
        scheduleReconnect();
      }
    };

    void connect();
    return () => {
      cancelled = true;
      socketRef.current?.close();
      socketRef.current = null;
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, [agentRunId, enabled]);

  return { timeline, isConnected, isInitialized, error };
}
