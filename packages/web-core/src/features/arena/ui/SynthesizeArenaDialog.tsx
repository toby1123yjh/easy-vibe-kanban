import { create, useModal } from '@ebay/nice-modal-react';
import { useState } from 'react';
import { Button } from '@vibe/ui/components/Button';
import { Checkbox } from '@vibe/ui/components/Checkbox';
import { Textarea } from '@vibe/ui/components/Textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@vibe/ui/components/KeyboardDialog';
import type { ArenaSynthesizeOptions } from '@/shared/lib/arenaApi';
import { defineModal } from '@/shared/lib/modals';

interface SynthesizeArenaDialogProps {
  activityCount: number;
  attemptCount: number;
}

export type SynthesizeArenaDialogResult =
  | {
      kind: 'confirmed';
      prompt: string;
      options: ArenaSynthesizeOptions;
    }
  | { kind: 'canceled' };

const DEFAULT_PROMPT =
  'Synthesize the Arena attempts into a concise decision memo. Preserve disagreement, tradeoffs, and open risks.';

const SynthesizeArenaDialogImpl = create<SynthesizeArenaDialogProps>(
  ({ activityCount, attemptCount }) => {
    const modal = useModal();
    const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
    const [options, setOptions] = useState<ArenaSynthesizeOptions>({
      include_original_prompt: true,
      include_attempt_summaries: true,
      include_activity: activityCount > 0,
    });

    const trimmedPrompt = prompt.trim();
    const canSubmit =
      trimmedPrompt.length > 0 &&
      (options.include_original_prompt ||
        options.include_attempt_summaries ||
        options.include_activity);

    const updateOption = (
      key: keyof ArenaSynthesizeOptions,
      checked: boolean
    ) => {
      setOptions((current) => ({ ...current, [key]: checked }));
    };

    const handleCancel = () => {
      modal.resolve({ kind: 'canceled' } satisfies SynthesizeArenaDialogResult);
      modal.hide();
    };

    const handleConfirm = () => {
      if (!canSubmit) return;
      modal.resolve({
        kind: 'confirmed',
        prompt: trimmedPrompt,
        options,
      } satisfies SynthesizeArenaDialogResult);
      modal.hide();
    };

    return (
      <Dialog open={modal.visible} onOpenChange={handleCancel}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Synthesize Arena</DialogTitle>
            <DialogDescription className="text-left">
              Select context for the decision memo.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-base">
            <div className="space-y-half">
              <label className="text-xs font-medium text-low">
                Synthesis instruction
              </label>
              <Textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                rows={4}
                className="font-ibm-plex-mono"
              />
            </div>

            <div className="space-y-half">
              <div className="text-xs font-medium text-low">Include</div>
              <div className="space-y-half rounded border border-zinc-200 bg-secondary p-half dark:border-zinc-800">
                <label className="flex items-center gap-half text-sm">
                  <Checkbox
                    checked={options.include_original_prompt}
                    onCheckedChange={(checked) =>
                      updateOption('include_original_prompt', checked)
                    }
                  />
                  Original Arena prompt
                </label>
                <label className="flex items-center gap-half text-sm">
                  <Checkbox
                    checked={options.include_attempt_summaries}
                    onCheckedChange={(checked) =>
                      updateOption('include_attempt_summaries', checked)
                    }
                  />
                  Attempt summaries ({attemptCount})
                </label>
                <label className="flex items-center gap-half text-sm">
                  <Checkbox
                    checked={options.include_activity}
                    disabled={activityCount === 0}
                    onCheckedChange={(checked) =>
                      updateOption('include_activity', checked)
                    }
                  />
                  Arena activity ({activityCount})
                </label>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleCancel}>
              Cancel
            </Button>
            <Button type="button" disabled={!canSubmit} onClick={handleConfirm}>
              Create memo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }
);

export const SynthesizeArenaDialog = defineModal<
  SynthesizeArenaDialogProps,
  SynthesizeArenaDialogResult
>(SynthesizeArenaDialogImpl);
