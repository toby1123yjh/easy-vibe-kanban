import type { CSSProperties, HTMLAttributes } from 'react';

import { cn } from '../lib/cn';

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  shape?: 'line' | 'rectangle' | 'circle';
  width?: CSSProperties['width'];
  height?: CSSProperties['height'];
  label?: string;
}

export function Skeleton({
  shape = 'rectangle',
  width,
  height,
  label,
  className,
  style,
  ...props
}: SkeletonProps) {
  return (
    <div
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn(
        'relative overflow-hidden bg-[var(--vk-skeleton-base)] motion-safe:animate-pulse',
        'before:absolute before:inset-0 before:bg-gradient-to-r before:from-transparent before:via-[var(--vk-skeleton-highlight)] before:to-transparent before:opacity-40',
        shape === 'line' &&
          'h-[var(--vk-line-height-sm)] rounded-[var(--vk-radius-sm)]',
        shape === 'rectangle' && 'rounded-[var(--vk-radius-md)]',
        shape === 'circle' && 'aspect-square rounded-full',
        className
      )}
      style={{ width, height, ...style }}
      {...props}
    />
  );
}
