import type { ReactNode } from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';

import { cn } from '../lib/cn';
import { getModifierKey } from '../lib/platform';

export interface TooltipProps {
  children: ReactNode;
  content: ReactNode;
  shortcut?: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  delayDuration?: number;
  disabled?: boolean;
}

export function Tooltip({
  children,
  content,
  shortcut,
  side = 'bottom',
  className,
  open,
  defaultOpen,
  onOpenChange,
  delayDuration = 300,
  disabled = false,
}: TooltipProps) {
  const formattedShortcut = shortcut?.replace('{mod}', getModifierKey());

  return (
    <TooltipPrimitive.Provider delayDuration={delayDuration}>
      <TooltipPrimitive.Root
        open={disabled ? false : open}
        defaultOpen={defaultOpen}
        onOpenChange={disabled ? undefined : onOpenChange}
      >
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={side}
            sideOffset={6}
            collisionPadding={8}
            className={cn(
              'z-[var(--vk-z-tooltip)] flex max-w-xs items-center gap-[var(--vk-space-2)]',
              'rounded-[var(--vk-tooltip-radius)] bg-[var(--vk-tooltip-surface)] px-[var(--vk-space-2)] py-[var(--vk-space-1)]',
              'break-words text-[length:var(--vk-font-size-2xs)] leading-[var(--vk-line-height-2xs)] text-[var(--vk-tooltip-text)] shadow-[var(--vk-tooltip-shadow)]',
              'data-[state=delayed-open]:animate-in data-[state=closed]:animate-out',
              'data-[state=delayed-open]:fade-in-0 data-[state=closed]:fade-out-0',
              'data-[state=delayed-open]:zoom-in-95 data-[state=closed]:zoom-out-95',
              className
            )}
          >
            <span className="min-w-0">{content}</span>
            {formattedShortcut && (
              <kbd
                className={cn(
                  'inline-flex shrink-0 items-center gap-0.5 rounded-[var(--vk-radius-sm)] border border-current px-[var(--vk-space-1)]',
                  'font-mono text-[length:var(--vk-font-size-2xs)] leading-[var(--vk-line-height-2xs)]'
                )}
              >
                {formattedShortcut}
              </kbd>
            )}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
