import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  workflowApi,
  parseWorkflowEvent,
  type WorkflowEventKind,
  type WorkflowRuntimeEvent,
} from '@/shared/lib/workflowApi';
import { workflowRunQueryKeys } from './useWorkflowRun';
import { useHostId } from '@/shared/providers/HostIdProvider';

export interface UseWorkflowRunEventsOptions {
  enabled?: boolean;
  onEvent?: (event: WorkflowRuntimeEvent, rawEvent: MessageEvent) => void;
  onRawEvent?: (event: MessageEvent) => void;
  onError?: (error: Event) => void;
}

const EVENT_KINDS: WorkflowEventKind[] = [
  'run_status',
  'node_status',
  'node_output',
  'node_error',
  'node_waiting_human',
  'node_waiting_arena',
];

export function useWorkflowRunEvents(
  runId: string | null | undefined,
  options: UseWorkflowRunEventsOptions = {}
) {
  const { enabled = true, onEvent, onRawEvent, onError } = options;
  const queryClient = useQueryClient();
  const hostId = useHostId();
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    // Keep it browser-safe if EventSource is unavailable.
    if (typeof window === 'undefined' || !window.EventSource) {
      return;
    }

    // Relay requests use the signed transport; native EventSource cannot carry
    // it. Remote runs retain the host-scoped polling in useWorkflowRun.
    if (!runId || !enabled || hostId) {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      return;
    }

    const url = workflowApi.eventsUrl(runId);
    const es = new EventSource(url, { withCredentials: true });
    eventSourceRef.current = es;

    const handleNamedEvent = (rawEvent: MessageEvent) => {
      onRawEvent?.(rawEvent);
      const parsedEvent = parseWorkflowEvent(rawEvent);
      if (parsedEvent) {
        onEvent?.(parsedEvent, rawEvent);
      }
      // Invalidate the run query on specific workflow events
      void queryClient.invalidateQueries({
        queryKey: workflowRunQueryKeys.detail(runId, hostId),
      });
    };

    // Attach listeners for specific backend events
    EVENT_KINDS.forEach((kind) => {
      es.addEventListener(kind, handleNamedEvent);
    });

    // Keep a generic message listener in case there are generic updates
    es.onmessage = (rawEvent) => {
      onRawEvent?.(rawEvent);
      const parsedEvent = parseWorkflowEvent(rawEvent);
      if (parsedEvent) {
        onEvent?.(parsedEvent, rawEvent);
      }
    };

    es.onerror = (error) => {
      onError?.(error);
    };

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, [runId, enabled, hostId, onEvent, onRawEvent, onError, queryClient]);

  return {
    eventSource: eventSourceRef.current,
  };
}
