import { forwardRef, type ReactNode } from 'react';
import type { PageCanvasMode } from '../model/appShell';

interface PageCanvasProps {
  children: ReactNode;
  mode: PageCanvasMode;
}

export const PageCanvas = forwardRef<HTMLElement, PageCanvasProps>(
  function PageCanvas({ children, mode }, ref) {
    return (
      <main
        ref={ref}
        id="main-content"
        tabIndex={-1}
        className="vk-page-canvas"
        data-mode={mode}
        data-scroll-restoration-id="page-canvas"
      >
        <div className="vk-page-canvas__content">{children}</div>
      </main>
    );
  }
);
