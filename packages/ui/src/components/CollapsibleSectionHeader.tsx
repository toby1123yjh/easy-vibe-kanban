import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import type { Icon } from '@phosphor-icons/react';
import { CaretDownIcon } from '@phosphor-icons/react';
import { cn } from '../lib/cn';

const STORAGE_KEY_PREFIX = 'vibe.ui.collapsible.';

function getInitialExpanded(
  persistKey: string | undefined,
  defaultExpanded: boolean
) {
  if (!persistKey || typeof window === 'undefined') return defaultExpanded;
  try {
    const stored = window.localStorage.getItem(
      `${STORAGE_KEY_PREFIX}${persistKey}`
    );
    if (stored == null) return defaultExpanded;
    return stored === 'true';
  } catch {
    return defaultExpanded;
  }
}

export type SectionAction = {
  icon: Icon;
  onClick: () => void;
  isActive?: boolean;
  label?: string;
  title?: string;
};

interface CollapsibleSectionHeaderProps {
  persistKey?: string;
  title: string;
  defaultExpanded?: boolean;
  collapsible?: boolean;
  actions?: SectionAction[];
  headerExtra?: ReactNode;
  children?: ReactNode;
  className?: string;
}

export function CollapsibleSectionHeader({
  persistKey,
  title,
  defaultExpanded = true,
  collapsible = true,
  actions = [],
  headerExtra,
  children,
  className,
}: CollapsibleSectionHeaderProps) {
  const [expanded, setExpanded] = useState(() =>
    getInitialExpanded(persistKey, defaultExpanded)
  );

  useEffect(() => {
    setExpanded(getInitialExpanded(persistKey, defaultExpanded));
  }, [persistKey, defaultExpanded]);

  useEffect(() => {
    if (!persistKey) return;
    try {
      window.localStorage.setItem(
        `${STORAGE_KEY_PREFIX}${persistKey}`,
        String(expanded)
      );
    } catch {
      // Ignore localStorage failures (private mode/quota/security errors).
    }
  }, [persistKey, expanded]);

  const isExpanded = collapsible ? expanded : true;

  const headerContent = (
    <>
      <span className="font-medium truncate text-normal">{title}</span>
      <div className="flex items-center gap-half">
        {headerExtra}
        {actions.map((action, index) => {
          const ActionIcon = action.icon;
          const actionLabel = action.label ?? action.title;
          return (
            <button
              key={index}
              aria-label={actionLabel}
              title={action.title ?? action.label}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                action.onClick();
              }}
              className={cn(
                'flex min-h-11 min-w-11 items-center justify-center rounded-sm cursor-pointer hover:text-normal focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2',
                action.isActive ? 'text-brand' : 'text-low'
              )}
            >
              <ActionIcon className="size-icon-xs" weight="bold" />
            </button>
          );
        })}
        {collapsible && (
          <CaretDownIcon
            weight="fill"
            className={cn(
              'size-icon-xs text-low transition-transform',
              !expanded && '-rotate-90'
            )}
          />
        )}
      </div>
    </>
  );

  return (
    <div className={cn('flex flex-col h-full min-h-0', className)}>
      <div className="">
        {collapsible ? (
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            className={cn(
              'flex items-center justify-between w-full px-base py-half cursor-pointer'
            )}
          >
            {headerContent}
          </button>
        ) : (
          <div
            className={cn(
              'flex items-center justify-between w-full px-base py-half'
            )}
          >
            {headerContent}
          </div>
        )}
      </div>
      {isExpanded && children}
    </div>
  );
}
