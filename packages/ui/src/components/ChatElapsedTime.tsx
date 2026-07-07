import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '../lib/cn';

interface ChatElapsedTimeProps {
  startedAt?: string | null;
  endedAt?: string | null;
  active?: boolean;
  className?: string;
}

function parseTime(value?: string | null) {
  if (!value) return null;

  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

function formatElapsedMs(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}

export function ChatElapsedTime({
  startedAt,
  endedAt,
  active = false,
  className,
}: ChatElapsedTimeProps) {
  const [now, setNow] = useState(() => Date.now());
  const [fallbackEndedAtMs, setFallbackEndedAtMs] = useState<number | null>(
    null
  );
  const hasBeenActiveRef = useRef(active);
  const startedAtMs = useMemo(() => parseTime(startedAt), [startedAt]);
  const endedAtMs = useMemo(() => parseTime(endedAt), [endedAt]);

  useEffect(() => {
    setFallbackEndedAtMs(null);
    hasBeenActiveRef.current = false;
  }, [startedAtMs, endedAtMs]);

  useEffect(() => {
    if (!active || !startedAtMs) return;

    hasBeenActiveRef.current = true;
    setNow(Date.now());
    const intervalId = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [active, startedAtMs]);

  useEffect(() => {
    if (active || !startedAtMs || endedAtMs || !hasBeenActiveRef.current) {
      return;
    }

    setFallbackEndedAtMs((current) => current ?? Date.now());
  }, [active, startedAtMs, endedAtMs]);

  if (!startedAtMs) return null;

  const fallbackEnd =
    fallbackEndedAtMs ?? (hasBeenActiveRef.current ? now : null);
  const effectiveEnd = active ? now : (endedAtMs ?? fallbackEnd);

  if (effectiveEnd == null) return null;

  return (
    <span
      className={cn(
        'shrink-0 text-xs tabular-nums text-low',
        active && 'text-normal',
        className
      )}
    >
      {formatElapsedMs(effectiveEnd - startedAtMs)}
    </span>
  );
}
