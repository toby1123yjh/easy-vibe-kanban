import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '../lib/cn';

interface ActivityTextProps extends HTMLAttributes<HTMLSpanElement> {
  active?: boolean;
}

export const ActivityText = forwardRef<HTMLSpanElement, ActivityTextProps>(
  function ActivityText({ active = true, className, children, ...props }, ref) {
    return (
      <span
        ref={ref}
        className={cn(active && 'vk-activity-text', className)}
        {...props}
      >
        {children}
      </span>
    );
  }
);
