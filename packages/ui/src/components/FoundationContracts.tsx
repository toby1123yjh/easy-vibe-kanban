import { useId, useState } from 'react';

import type { ThemeMode } from '../lib/theme';
import { Badge } from './Badge';
import { Button } from './Button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './Dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './DropdownMenu';
import {
  FloatingPanel,
  FloatingPanelBody,
  FloatingPanelDescription,
  FloatingPanelFooter,
  FloatingPanelHeader,
  FloatingPanelTitle,
} from './FloatingPanel';
import { Input } from './Input';
import { Loader } from './Loader';
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from './Popover';
import { Skeleton } from './Skeleton';
import { SplitLayout } from './SplitLayout';
import { EmptyState, ErrorState } from './StateSurface';
import { Status } from './Status';
import { Tooltip } from './Tooltip';

const themeModeContracts = [
  'system',
  'light',
  'dark',
] as const satisfies readonly ThemeMode[];

/**
 * Compile-checked examples for the Phase 2 foundation contracts. This is not
 * a product route; it keeps controlled and accessibility-sensitive component
 * usage valid while later pages migrate onto the shared primitives.
 */
export function FoundationContracts() {
  const [secondarySize, setSecondarySize] = useState(380);
  const [panelOpen, setPanelOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const panelTitleId = useId();
  const panelDescriptionId = useId();
  const invalidInputDescriptionId = useId();

  return (
    <section
      aria-label="UI foundation contracts"
      data-reduced-motion-intent="system-preference"
      className="min-h-0 text-[var(--vk-text-normal)] motion-reduce:transition-none"
    >
      <div aria-label="Theme intents" className="sr-only">
        {themeModeContracts.map((mode) => (
          <span key={mode} data-theme-mode={mode}>
            {mode}
          </span>
        ))}
      </div>

      <div className="grid gap-[var(--vk-space-4)] p-[var(--vk-space-4)]">
        <div
          role="group"
          aria-label="Button interaction states"
          className="flex flex-wrap items-center gap-[var(--vk-space-2)]"
        >
          <Button>默认操作</Button>
          <Button loading loadingLabel="正在保存">
            保存中
          </Button>
          <Button disabled>不可用操作</Button>
          <Button variant="secondary" selected>
            当前已选择
          </Button>
          <Button asChild disabled>
            <a href="#disabled-foundation-action">禁用链接操作</a>
          </Button>
        </div>

        <div
          role="group"
          aria-label="Input interaction states"
          className="grid gap-[var(--vk-space-2)] sm:grid-cols-2"
        >
          <div>
            <Input
              aria-label="无效的智能体地址"
              aria-describedby={invalidInputDescriptionId}
              invalid
              defaultValue="不是有效地址"
            />
            <p
              id={invalidInputDescriptionId}
              className="mt-[var(--vk-space-1)] text-[length:var(--vk-font-size-xs)] text-[var(--vk-status-error-text)]"
            >
              请输入完整且可访问的 API 地址。
            </p>
          </div>
          <Input
            aria-label="只读配置来源"
            readOnly
            value="从本机智能体配置导入"
          />
          <Input
            aria-label="禁用的配置字段"
            disabled
            value="当前环境不可编辑"
          />
          <Input
            aria-label="本地化字段示例"
            placeholder="输入一段很长的中文配置内容以验证换行和焦点状态"
            onCommandEnter={() => setPanelOpen(true)}
          />
        </div>

        <div
          role="group"
          aria-label="Overlay interaction contracts"
          className="flex flex-wrap items-center gap-[var(--vk-space-2)]"
        >
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="secondary">打开确认对话框</Button>
            </DialogTrigger>
            <DialogContent className="p-[var(--vk-space-4)]">
              <DialogHeader>
                <DialogTitle>确认更新智能体配置</DialogTitle>
                <DialogDescription>
                  这段较长的本地化说明用于验证对话框在内容换行后仍有清晰标题、描述和可访问关闭路径。
                </DialogDescription>
              </DialogHeader>
              <div
                role="group"
                aria-label="Dialog nested layer contracts"
                className="mt-[var(--vk-space-4)] flex flex-wrap gap-[var(--vk-space-2)]"
              >
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="secondary">打开操作菜单</Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent aria-label="智能体操作菜单">
                    <DropdownMenuLabel>可用操作</DropdownMenuLabel>
                    <DropdownMenuItem selected>当前选择的配置</DropdownMenuItem>
                    <DropdownMenuItem disabled>此环境暂不支持</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="danger">
                      删除本地配置
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="secondary">打开辅助说明</Button>
                  </PopoverTrigger>
                  <PopoverContent aria-label="配置辅助说明">
                    <p>
                      浮层可以承载较长的中文提示，但不会替代需要明确确认的重要对话框。
                    </p>
                    <PopoverClose asChild>
                      <Button className="mt-[var(--vk-space-3)]" size="sm">
                        知道了
                      </Button>
                    </PopoverClose>
                  </PopoverContent>
                </Popover>
              </div>
              <DialogFooter className="mt-[var(--vk-space-4)]">
                <DialogClose asChild>
                  <Button variant="secondary">取消</Button>
                </DialogClose>
                <DialogClose asChild>
                  <Button>确认更新</Button>
                </DialogClose>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Tooltip
            content="打开包含较长中文说明和本地化内容的非模态配置面板"
            shortcut="{mod}+I"
          >
            <Button
              variant="secondary"
              aria-keyshortcuts="Control+I Meta+I"
              onClick={() => setPanelOpen(true)}
            >
              打开右侧配置面板
            </Button>
          </Tooltip>
        </div>

        <div
          role="group"
          aria-label="Status and loading contracts"
          className="flex flex-wrap items-center gap-[var(--vk-space-3)]"
        >
          <Status
            status="running"
            selected
            pulse
            label="正在执行并且当前已选中"
          />
          <Badge variant="waiting" selected tabIndex={0}>
            等待用户批准后继续执行
          </Badge>
          <Loader inline message="正在加载智能体能力" size={16} />
          <Skeleton shape="line" width="12rem" label="正在加载辅助区域" />
        </div>

        <div className="grid gap-[var(--vk-space-3)] sm:grid-cols-2">
          <EmptyState
            compact
            title="暂时没有会话"
            description="启动一次智能体执行后，会话会显示在这里。"
            action={<Button size="sm">启动执行</Button>}
          />
          <ErrorState
            compact
            title="配置加载失败"
            description="检查本机智能体是否可用，然后重新加载。"
            action={
              <Button size="sm" variant="secondary">
                重新加载
              </Button>
            }
          />
        </div>
      </div>

      <SplitLayout
        className="h-64"
        primary={
          <div className="h-full overflow-auto p-[var(--vk-space-4)]">
            主要内容区域在分栏尺寸调整时保持稳定，并保留自己的滚动上下文。
          </div>
        }
        secondary={
          <div className="h-full overflow-auto p-[var(--vk-space-4)]">
            <Skeleton shape="line" width="80%" label="正在加载辅助区域" />
          </div>
        }
        secondarySize={secondarySize}
        onSecondarySizeChange={setSecondarySize}
        secondaryPlacement="end"
        separatorLabel="调整辅助区域宽度"
      />

      <FloatingPanel
        open={panelOpen}
        onOpenChange={setPanelOpen}
        autoFocus
        aria-labelledby={panelTitleId}
        aria-describedby={panelDescriptionId}
        closeLabel="关闭右侧配置面板"
      >
        <FloatingPanelHeader>
          <FloatingPanelTitle id={panelTitleId}>
            智能体节点配置
          </FloatingPanelTitle>
          <FloatingPanelDescription id={panelDescriptionId}>
            这是较长的本地化说明文本，用于确认标题、描述和关闭按钮在窄面板中仍然保持可读且不会截断关键信息。
          </FloatingPanelDescription>
        </FloatingPanelHeader>
        <FloatingPanelBody className="space-y-[var(--vk-space-4)]">
          {Array.from({ length: 12 }, (_, index) => (
            <Input
              key={index}
              aria-label={`配置字段 ${index + 1}`}
              placeholder={`配置字段 ${index + 1}`}
            />
          ))}
        </FloatingPanelBody>
        <FloatingPanelFooter>
          <Button variant="secondary" onClick={() => setPanelOpen(false)}>
            完成
          </Button>
        </FloatingPanelFooter>
      </FloatingPanel>
    </section>
  );
}
