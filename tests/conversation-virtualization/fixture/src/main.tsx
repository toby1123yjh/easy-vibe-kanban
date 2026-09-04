import * as React from 'react';
import { createRoot } from 'react-dom/client';
import {
  useConversationVirtualizer,
  type ConversationRow,
} from '@web-core/features/workspace-chat/model/useConversationVirtualizer';
import type { DisplayEntry } from '@web-core/shared/hooks/useConversationHistory/types';
import '@ui/styles/tokens.css';
import './style.css';

const MESSAGE_COUNT = 1000;

const rows: ConversationRow[] = Array.from(
  { length: MESSAGE_COUNT },
  (_, index) => ({
    semanticKey: `fixture-message-${index}`,
    rowFamily: 'tool_summary',
    processId: null,
    estimationHint: 'compact',
    isUserMessage: false,
    // The fixture renders a lightweight row shell; production entries are
    // rendered by DisplayConversationEntry after virtualization selects them.
    entry: {} as DisplayEntry,
  })
);

function ConversationVirtualizationFixture() {
  const scrollContainerRef = React.useRef<HTMLDivElement>(null);
  const { virtualItems, totalSize, measureElement } =
    useConversationVirtualizer({
      rows,
      totalRowCount: rows.length,
      scrollContainerRef,
    });

  return (
    <main>
      <h1>1000-message conversation</h1>
      <label>
        Interaction input
        <input data-testid="interaction-input" />
      </label>
      <output data-testid="virtual-count">{virtualItems.length}</output>
      <div
        ref={scrollContainerRef}
        data-testid="conversation-scroll"
        className="conversation-scroll"
      >
        <div
          className="conversation-spacer"
          style={{ height: `${totalSize}px` }}
        >
          {virtualItems.map((item) => (
            <div
              key={rows[item.index].semanticKey}
              ref={measureElement}
              data-index={item.index}
              data-testid="message-row"
              className="message-row"
              style={{ transform: `translateY(${item.start}px)` }}
            >
              Message {item.index + 1}
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}

const root = document.getElementById('root');
if (!root)
  throw new Error('Conversation virtualization fixture root is missing');
createRoot(root).render(<ConversationVirtualizationFixture />);
