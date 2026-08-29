import type { ReactElement, ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

import { cn } from '../lib/cn';

export interface LoaderProps {
  message?: ReactNode;
  label?: string;
  size?: number;
  className?: string;
  inline?: boolean;
}

export function Loader({
  message,
  label = 'Loading',
  size = 32,
  className,
  inline = false,
}: LoaderProps): ReactElement {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={message ? undefined : label}
      className={cn(
        'items-center justify-center gap-[var(--vk-space-2)] text-[var(--vk-loader-color)]',
        inline ? 'inline-flex flex-row' : 'flex flex-col',
        className
      )}
    >
      <Loader2
        aria-hidden="true"
        className="shrink-0 animate-spin motion-reduce:animate-none"
        style={{ width: size, height: size }}
      />
      {message && (
        <div className="min-w-0 break-words text-center text-[length:var(--vk-font-size-sm)] leading-[var(--vk-line-height-sm)]">
          {message}
        </div>
      )}
    </div>
  );
}
