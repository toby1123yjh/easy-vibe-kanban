import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Bot,
  Boxes,
  ChevronRight,
  CircleUserRound,
  FolderKanban,
  Gauge,
  GitBranch,
  LoaderCircle,
  Menu,
  MessageSquareText,
  MoreHorizontal,
  RefreshCw,
  Search,
  Settings,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { ProjectListItem, SessionListItem } from 'shared/types';
import type { AppShellCapabilityAdapter, ShellModule } from '../model/appShell';
import { activateShellModuleCapability } from '../model/appShell';

const MODULES: readonly {
  id: ShellModule;
  label: string;
  icon: LucideIcon;
}[] = [
  { id: 'dashboard', label: 'Dashboard', icon: Gauge },
  { id: 'search', label: 'Search', icon: Search },
  { id: 'projects', label: 'Projects', icon: FolderKanban },
  { id: 'workflows', label: 'Workflows', icon: GitBranch },
  { id: 'agents', label: 'Agents', icon: Bot },
];

export interface SidebarSectionState<T> {
  items: readonly T[];
  isLoading: boolean;
  isError: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  retry(): void;
  loadNextPage(): void;
}

interface ProductSidebarProps {
  adapter: AppShellCapabilityAdapter;
  activeModule: ShellModule | null;
  activeProjectId: string | null;
  activeWorkspaceId: string | null;
  projects: SidebarSectionState<ProjectListItem>;
  sessions: SidebarSectionState<SessionListItem>;
  objectDrawerOpen: boolean;
  onObjectDrawerOpenChange(open: boolean): void;
  onSearch(): void;
  onProject(projectId: string): void;
  onSession(workspaceId: string): void;
}

function SectionState({
  state,
  emptyLabel,
}: {
  state: SidebarSectionState<unknown>;
  emptyLabel: string;
}) {
  if (state.isLoading) {
    return (
      <p className="vk-sidebar-state" role="status">
        <LoaderCircle className="vk-spin" aria-hidden="true" size={14} />
        Loading…
      </p>
    );
  }
  if (state.isError) {
    return (
      <button type="button" className="vk-sidebar-state" onClick={state.retry}>
        <RefreshCw aria-hidden="true" size={14} />
        Retry
      </button>
    );
  }
  if (state.items.length === 0) {
    return <p className="vk-sidebar-state">{emptyLabel}</p>;
  }
  return null;
}

function AutoPageSentinel({ state }: { state: SidebarSectionState<unknown> }) {
  const triggerRef = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, loadNextPage } = state;

  useEffect(() => {
    const trigger = triggerRef.current;
    if (!trigger || !hasNextPage || isFetchingNextPage) return;
    const root = trigger.closest('.vk-object-lists');
    if (!(root instanceof HTMLElement)) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) loadNextPage();
      },
      { root, rootMargin: '120px 0px' }
    );
    observer.observe(trigger);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, loadNextPage]);

  if (!hasNextPage) return null;
  return (
    <div
      ref={triggerRef}
      className="vk-sidebar-load-more"
      role="status"
      aria-label={
        isFetchingNextPage ? 'Loading more items' : 'More items available'
      }
    >
      {isFetchingNextPage && (
        <>
          <LoaderCircle className="vk-spin" aria-hidden="true" size={13} />
          Loading…
        </>
      )}
    </div>
  );
}

function VolumeAwareList<T extends { id: string }>({
  items,
  estimateSize,
  renderItem,
}: {
  items: readonly T[];
  estimateSize: number;
  renderItem(item: T): ReactNode;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [scrollElement, setScrollElement] = useState<HTMLElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);

  useLayoutEffect(() => {
    const list = listRef.current;
    const scroll = list?.closest('.vk-object-lists');
    setScrollElement(scroll instanceof HTMLElement ? scroll : null);
  }, []);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || !scrollElement || items.length <= 50) return;
    const measure = () => {
      const listRect = list.getBoundingClientRect();
      const scrollRect = scrollElement.getBoundingClientRect();
      setScrollMargin(listRect.top - scrollRect.top + scrollElement.scrollTop);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    observer.observe(scrollElement);
    return () => observer.disconnect();
  }, [items.length, scrollElement]);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollElement,
    estimateSize: () => estimateSize,
    overscan: 8,
    scrollMargin,
    enabled: items.length > 50,
  });

  if (items.length <= 50) {
    return <>{items.map((item) => renderItem(item))}</>;
  }

  return (
    <div
      ref={listRef}
      className="vk-virtual-list"
      style={{ height: virtualizer.getTotalSize() }}
    >
      {virtualizer.getVirtualItems().map((virtualItem) => {
        const item = items[virtualItem.index];
        return (
          <div
            key={item.id}
            className="vk-virtual-list__row"
            ref={virtualizer.measureElement}
            data-index={virtualItem.index}
            style={{
              transform: `translateY(${virtualItem.start - scrollMargin}px)`,
            }}
          >
            {renderItem(item)}
          </div>
        );
      })}
    </div>
  );
}

function PrimaryNavigation({
  adapter,
  activeModule,
  onSearch,
  iconOnly = false,
  onOpenObjects,
}: Pick<ProductSidebarProps, 'adapter' | 'activeModule' | 'onSearch'> & {
  iconOnly?: boolean;
  onOpenObjects?(): void;
}) {
  const reasonIdPrefix = useId();

  return (
    <nav className="vk-primary-nav" aria-label="Primary">
      {MODULES.map(({ id, label, icon: Icon }) => {
        const capability =
          id === 'search' ? null : adapter.moduleCapabilities[id];
        const unavailableReason =
          capability?.availability === 'unavailable' ? capability.reason : null;
        const reasonId = unavailableReason
          ? `${reasonIdPrefix}-${id}-unavailable`
          : undefined;
        const isActive = id !== 'search' && id === activeModule;
        return (
          <button
            type="button"
            key={id}
            className="vk-primary-nav__item"
            data-active={isActive}
            data-availability={unavailableReason ? 'unavailable' : 'available'}
            aria-disabled={unavailableReason ? true : undefined}
            aria-describedby={reasonId}
            aria-current={isActive ? 'page' : undefined}
            aria-label={iconOnly ? label : undefined}
            title={
              unavailableReason
                ? `${label} — unavailable: ${unavailableReason}`
                : iconOnly
                  ? label
                  : undefined
            }
            onClick={() => {
              if (id === 'search') onSearch();
              else if (capability) activateShellModuleCapability(capability);
            }}
          >
            <Icon aria-hidden="true" size={18} />
            {!iconOnly && (
              <span className="vk-primary-nav__copy">
                <span>{label}</span>
                {unavailableReason && (
                  <small id={reasonId}>{unavailableReason}</small>
                )}
              </span>
            )}
            {iconOnly && unavailableReason && (
              <span
                id={reasonId}
                className="vk-module-unavailable-reason"
                role="tooltip"
              >
                {unavailableReason}
              </span>
            )}
          </button>
        );
      })}
      {iconOnly && onOpenObjects && (
        <button
          type="button"
          className="vk-primary-nav__item"
          aria-label="Browse projects and sessions"
          title="Browse projects and sessions"
          onClick={onOpenObjects}
        >
          <Menu aria-hidden="true" size={18} />
        </button>
      )}
    </nav>
  );
}

function ObjectLists({
  projects,
  sessions,
  activeProjectId,
  activeWorkspaceId,
  onProject,
  onSession,
}: Pick<
  ProductSidebarProps,
  | 'projects'
  | 'sessions'
  | 'activeProjectId'
  | 'activeWorkspaceId'
  | 'onProject'
  | 'onSession'
>) {
  const labelPrefix = useId();
  const projectsLabelId = `${labelPrefix}-projects-label`;
  const sessionsLabelId = `${labelPrefix}-sessions-label`;
  return (
    <div className="vk-object-lists" data-testid="shell-object-scroll">
      <section aria-labelledby={projectsLabelId}>
        <h2 id={projectsLabelId} className="vk-sidebar-section-label">
          Projects
        </h2>
        <SectionState state={projects} emptyLabel="No projects" />
        <VolumeAwareList
          items={projects.items}
          estimateSize={34}
          renderItem={(project) => (
            <button
              type="button"
              className="vk-object-link"
              data-active={project.id === activeProjectId}
              aria-current={project.id === activeProjectId ? 'page' : undefined}
              aria-label={project.name}
              title={project.name}
              onClick={() => onProject(project.id)}
            >
              <Boxes aria-hidden="true" size={15} />
              <span>{project.name}</span>
              <ChevronRight aria-hidden="true" size={14} />
            </button>
          )}
        />
        <AutoPageSentinel state={projects} />
      </section>

      <section aria-labelledby={sessionsLabelId}>
        <h2 id={sessionsLabelId} className="vk-sidebar-section-label">
          Sessions
        </h2>
        <SectionState state={sessions} emptyLabel="No sessions" />
        <VolumeAwareList
          items={sessions.items}
          estimateSize={48}
          renderItem={(session) => (
            <button
              type="button"
              className="vk-object-link"
              data-active={session.workspace_id === activeWorkspaceId}
              aria-current={
                session.workspace_id === activeWorkspaceId ? 'page' : undefined
              }
              aria-label={`${session.title}, ${session.executor ?? 'Agent'}`}
              title={`${session.title} — ${session.executor ?? 'Agent'}`}
              onClick={() => onSession(session.workspace_id)}
            >
              <MessageSquareText aria-hidden="true" size={15} />
              <span>
                {session.title}
                <small>{session.executor ?? 'Agent'}</small>
              </span>
              <ChevronRight aria-hidden="true" size={14} />
            </button>
          )}
        />
        <AutoPageSentinel state={sessions} />
      </section>
    </div>
  );
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  );
}

function ObjectDrawer(props: ProductSidebarProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const restoreTargetRef = useRef<HTMLElement | null>(null);
  const restoreFocusRef = useRef(true);
  const titleId = useId();
  const onObjectDrawerOpenChange = props.onObjectDrawerOpenChange;

  const dismiss = useCallback(
    (restoreFocus: boolean) => {
      restoreFocusRef.current = restoreFocus;
      onObjectDrawerOpenChange(false);
    },
    [onObjectDrawerOpenChange]
  );

  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    restoreTargetRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    const siblingInertStates = Array.from(overlay.parentElement?.children ?? [])
      .filter(
        (element): element is HTMLElement =>
          element instanceof HTMLElement && element !== overlay
      )
      .map((element) => ({ element, inert: element.inert }));
    for (const { element } of siblingInertStates) element.inert = true;

    const frame = requestAnimationFrame(() => {
      overlay
        .querySelector<HTMLElement>('[data-drawer-initial-focus]')
        ?.focus();
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        dismiss(true);
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = getFocusableElements(overlay);
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', handleKeyDown, { capture: true });
      for (const { element, inert } of siblingInertStates) {
        element.inert = inert;
      }
      if (restoreFocusRef.current && restoreTargetRef.current?.isConnected) {
        requestAnimationFrame(() =>
          restoreTargetRef.current?.focus({ preventScroll: true })
        );
      }
    };
  }, [dismiss]);

  return (
    <div
      ref={overlayRef}
      className="vk-object-drawer-scrim"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) dismiss(true);
      }}
    >
      <aside
        className="vk-object-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="vk-object-drawer__header">
          <strong id={titleId}>Browse projects and sessions</strong>
          <button
            type="button"
            data-drawer-initial-focus
            aria-label="Close projects and sessions"
            onClick={() => dismiss(true)}
          >
            <X aria-hidden="true" size={18} />
          </button>
        </div>
        <ObjectLists
          {...props}
          onProject={(projectId) => {
            dismiss(false);
            props.onProject(projectId);
          }}
          onSession={(workspaceId) => {
            dismiss(false);
            props.onSession(workspaceId);
          }}
        />
      </aside>
    </div>
  );
}

function MobileHeader({
  adapter,
  onBrowse,
}: Pick<ProductSidebarProps, 'adapter'> & { onBrowse(): void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!menuOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !menuRef.current?.contains(event.target) &&
        !triggerRef.current?.contains(event.target)
      ) {
        setMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setMenuOpen(false);
      triggerRef.current?.focus({ preventScroll: true });
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);

  const invoke = (action: () => void) => {
    setMenuOpen(false);
    action();
  };

  return (
    <header className="vk-mobile-header">
      <div className="vk-mobile-header__identity">
        <span className="vk-shell-identity__mark">VK</span>
        <span>
          <strong>Vibe Kanban</strong>
          <small>{adapter.environmentLabel}</small>
        </span>
      </div>
      <div className="vk-mobile-header__actions">
        <button type="button" onClick={onBrowse}>
          <Menu aria-hidden="true" size={18} />
          <span>Browse</span>
        </button>
        <button
          ref={triggerRef}
          type="button"
          aria-label="Open product menu"
          aria-expanded={menuOpen}
          aria-controls={menuId}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <MoreHorizontal aria-hidden="true" size={20} />
        </button>
      </div>
      {menuOpen && (
        <div
          ref={menuRef}
          id={menuId}
          className="vk-mobile-header__menu"
          role="menu"
        >
          {adapter.openUser && (
            <button
              type="button"
              role="menuitem"
              onClick={() => invoke(adapter.openUser!)}
            >
              <CircleUserRound aria-hidden="true" size={17} />
              {adapter.userLabel ?? 'User'}
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => invoke(adapter.openSettings)}
          >
            <Settings aria-hidden="true" size={17} />
            Settings
          </button>
          {adapter.versionLabel && (
            <small role="none">Version {adapter.versionLabel}</small>
          )}
        </div>
      )}
    </header>
  );
}

function Identity({ adapter }: { adapter: AppShellCapabilityAdapter }) {
  return (
    <div className="vk-shell-identity" data-tauri-drag-region>
      <span className="vk-shell-identity__mark">VK</span>
      <span className="vk-shell-identity__copy">
        <strong>Vibe Kanban</strong>
        <small>{adapter.environmentLabel}</small>
      </span>
    </div>
  );
}

function SystemZone({ adapter }: { adapter: AppShellCapabilityAdapter }) {
  return (
    <div className="vk-system-zone">
      {adapter.openUser && (
        <button type="button" onClick={adapter.openUser}>
          <CircleUserRound aria-hidden="true" size={17} />
          <span>{adapter.userLabel ?? 'User'}</span>
        </button>
      )}
      <button type="button" onClick={adapter.openSettings}>
        <Settings aria-hidden="true" size={17} />
        <span>Settings</span>
      </button>
      {adapter.versionLabel && <small>v{adapter.versionLabel}</small>}
    </div>
  );
}

export function ProductSidebar(props: ProductSidebarProps) {
  const mobileReasonIdPrefix = useId();

  return (
    <>
      <MobileHeader
        adapter={props.adapter}
        onBrowse={() => props.onObjectDrawerOpenChange(true)}
      />
      <aside className="vk-product-sidebar" aria-label="Product sidebar">
        <Identity adapter={props.adapter} />
        <PrimaryNavigation
          adapter={props.adapter}
          activeModule={props.activeModule}
          onSearch={props.onSearch}
        />
        <ObjectLists {...props} />
        <SystemZone adapter={props.adapter} />
      </aside>

      <aside className="vk-product-rail" aria-label="Product navigation rail">
        <span className="vk-shell-identity__mark">VK</span>
        <PrimaryNavigation
          adapter={props.adapter}
          activeModule={props.activeModule}
          onSearch={props.onSearch}
          iconOnly
          onOpenObjects={() => props.onObjectDrawerOpenChange(true)}
        />
        <button
          type="button"
          className="vk-product-rail__settings"
          aria-label="Settings"
          title="Settings"
          onClick={props.adapter.openSettings}
        >
          <Settings aria-hidden="true" size={18} />
        </button>
      </aside>

      {props.objectDrawerOpen && <ObjectDrawer {...props} />}

      <nav className="vk-bottom-nav" aria-label="Primary mobile navigation">
        {MODULES.map(({ id, label, icon: Icon }) => {
          const active = id !== 'search' && id === props.activeModule;
          const capability =
            id === 'search' ? null : props.adapter.moduleCapabilities[id];
          const unavailableReason =
            capability?.availability === 'unavailable'
              ? capability.reason
              : null;
          const reasonId = unavailableReason
            ? `${mobileReasonIdPrefix}-${id}-unavailable`
            : undefined;
          return (
            <button
              type="button"
              key={id}
              data-active={active}
              data-availability={
                unavailableReason ? 'unavailable' : 'available'
              }
              aria-disabled={unavailableReason ? true : undefined}
              aria-describedby={reasonId}
              aria-current={active ? 'page' : undefined}
              title={
                unavailableReason
                  ? `${label} — unavailable: ${unavailableReason}`
                  : undefined
              }
              onClick={() => {
                if (id === 'search') props.onSearch();
                else if (capability) activateShellModuleCapability(capability);
              }}
            >
              <Icon aria-hidden="true" size={20} />
              <span>{label}</span>
              {unavailableReason && (
                <span
                  id={reasonId}
                  className="vk-module-unavailable-reason"
                  role="tooltip"
                >
                  {unavailableReason}
                </span>
              )}
            </button>
          );
        })}
      </nav>
    </>
  );
}
