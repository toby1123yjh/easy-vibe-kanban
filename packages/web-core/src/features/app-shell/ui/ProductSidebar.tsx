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
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import type { ProjectListItem, SessionListItem } from 'shared/types';
import {
  DegradedState,
  EmptyState,
  ErrorState,
  LoadingState,
} from '@vibe/ui/components/StateSurface';
import type {
  AppShellCapabilityAdapter,
  AppShellUpdateNotice,
  ShellModule,
} from '../model/appShell';
import {
  activateShellModuleCapability,
  deriveSidebarSectionViewState,
} from '../model/appShell';

const MODULES: readonly {
  id: ShellModule;
  labelKey: `appShell.modules.${ShellModule}`;
  icon: LucideIcon;
}[] = [
  { id: 'dashboard', labelKey: 'appShell.modules.dashboard', icon: Gauge },
  { id: 'search', labelKey: 'appShell.modules.search', icon: Search },
  { id: 'projects', labelKey: 'appShell.modules.projects', icon: FolderKanban },
  {
    id: 'workflows',
    labelKey: 'appShell.modules.workflows',
    icon: GitBranch,
  },
  { id: 'agents', labelKey: 'appShell.modules.agents', icon: Bot },
];

function getUpdateNoticeLabel(
  updateNotice: AppShellUpdateNotice,
  t: TFunction<'common'>
) {
  return updateNotice.phase === 'restart-ready'
    ? t('appShell.system.updateReady', { version: updateNotice.version })
    : t('appShell.system.updateAvailable', { version: updateNotice.version });
}

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
  label,
  emptyLabel,
}: {
  state: SidebarSectionState<unknown>;
  label: string;
  emptyLabel: string;
}) {
  const { t } = useTranslation('common');
  const viewState = deriveSidebarSectionViewState({
    itemCount: state.items.length,
    isLoading: state.isLoading,
    isError: state.isError,
  });
  const retryAction = (
    <button type="button" className="vk-state-retry" onClick={state.retry}>
      {t('appShell.objects.retry')}
    </button>
  );

  switch (viewState) {
    case 'loading':
      return (
        <LoadingState
          compact
          className="vk-sidebar-state-surface"
          title={t('appShell.objects.loading', {
            label: label.toLocaleLowerCase(),
          })}
        />
      );
    case 'empty':
      return (
        <EmptyState
          compact
          className="vk-sidebar-state-surface"
          title={emptyLabel}
        />
      );
    case 'error':
      return (
        <ErrorState
          compact
          className="vk-sidebar-state-surface"
          title={t('appShell.objects.unavailable', { label })}
          description={t('appShell.objects.unavailableDescription', { label })}
          action={retryAction}
        />
      );
    case 'degraded':
      return (
        <DegradedState
          compact
          className="vk-sidebar-state-surface"
          title={t('appShell.objects.degraded', { label })}
          description={t('appShell.objects.cachedAvailable')}
          action={retryAction}
          role="status"
          aria-live="polite"
        />
      );
    case 'ready':
      return null;
  }
}

function AutoPageSentinel({ state }: { state: SidebarSectionState<unknown> }) {
  const { t } = useTranslation('common');
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
        isFetchingNextPage
          ? t('appShell.objects.loadingMore')
          : t('appShell.objects.moreAvailable')
      }
    >
      {isFetchingNextPage && (
        <>
          <LoaderCircle className="vk-spin" aria-hidden="true" size={13} />
          {t('appShell.objects.loadingMore')}
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
  const { t } = useTranslation('common');

  return (
    <nav
      className="vk-primary-nav"
      aria-label={t('appShell.navigation.primary')}
    >
      {MODULES.map(({ id, labelKey, icon: Icon }) => {
        const label = t(labelKey);
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
          aria-label={t('appShell.objects.browseTitle')}
          title={t('appShell.objects.browseTitle')}
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
  const { t } = useTranslation('common');
  const projectsLabelId = `${labelPrefix}-projects-label`;
  const sessionsLabelId = `${labelPrefix}-sessions-label`;
  return (
    <div className="vk-object-lists" data-testid="shell-object-scroll">
      <section aria-labelledby={projectsLabelId}>
        <h2 id={projectsLabelId} className="vk-sidebar-section-label">
          {t('appShell.objects.projects')}
        </h2>
        <SectionState
          state={projects}
          label={t('appShell.objects.projects')}
          emptyLabel={t('appShell.objects.noProjects')}
        />
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
          {t('appShell.objects.sessions')}
        </h2>
        <SectionState
          state={sessions}
          label={t('appShell.objects.sessions')}
          emptyLabel={t('appShell.objects.noSessions')}
        />
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
              aria-label={`${session.title}, ${session.executor ?? t('appShell.objects.agent')}`}
              title={`${session.title} — ${session.executor ?? t('appShell.objects.agent')}`}
              onClick={() => onSession(session.workspace_id)}
            >
              <MessageSquareText aria-hidden="true" size={15} />
              <span>
                {session.title}
                <small>{session.executor ?? t('appShell.objects.agent')}</small>
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
  const { t } = useTranslation('common');
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
          <strong id={titleId}>{t('appShell.objects.browseTitle')}</strong>
          <button
            type="button"
            data-drawer-initial-focus
            aria-label={t('appShell.objects.closeBrowse')}
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
  const { t } = useTranslation('common');

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
  const updateNotice = adapter.updateNotice;
  const updateNoticeLabel = updateNotice
    ? getUpdateNoticeLabel(updateNotice, t)
    : null;

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
          <span>{t('appShell.objects.browse')}</span>
        </button>
        <button
          ref={triggerRef}
          type="button"
          aria-label={t('appShell.system.openMenu')}
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
              {adapter.userLabel ?? t('appShell.system.user')}
            </button>
          )}
          {updateNotice && (
            <button
              type="button"
              role="menuitem"
              onClick={() => invoke(updateNotice.open)}
            >
              <RefreshCw aria-hidden="true" size={17} />
              {updateNoticeLabel}
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => invoke(adapter.openSettings)}
          >
            <Settings aria-hidden="true" size={17} />
            {t('appShell.system.settings')}
          </button>
          {adapter.versionLabel && (
            <small role="none">
              {t('appShell.system.version')} {adapter.versionLabel}
            </small>
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
  const { t } = useTranslation('common');
  const updateNotice = adapter.updateNotice;
  const updateNoticeLabel = updateNotice
    ? getUpdateNoticeLabel(updateNotice, t)
    : null;

  return (
    <div className="vk-system-zone">
      {adapter.openUser && (
        <button type="button" onClick={adapter.openUser}>
          <CircleUserRound aria-hidden="true" size={17} />
          <span>{adapter.userLabel ?? t('appShell.system.user')}</span>
        </button>
      )}
      <button type="button" onClick={adapter.openSettings}>
        <Settings aria-hidden="true" size={17} />
        <span>{t('appShell.system.settings')}</span>
      </button>
      {updateNotice && (
        <button
          type="button"
          className="vk-system-zone__update"
          data-update-phase={updateNotice.phase}
          onClick={updateNotice.open}
        >
          <RefreshCw aria-hidden="true" size={17} />
          <span>{updateNoticeLabel}</span>
        </button>
      )}
      {adapter.versionLabel && <small>v{adapter.versionLabel}</small>}
    </div>
  );
}

export function ProductSidebar(props: ProductSidebarProps) {
  const mobileReasonIdPrefix = useId();
  const { t } = useTranslation('common');
  const updateNotice = props.adapter.updateNotice;
  const updateNoticeLabel = updateNotice
    ? getUpdateNoticeLabel(updateNotice, t)
    : '';

  return (
    <>
      <p
        className="vk-app-shell__update-announcement"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {updateNoticeLabel}
      </p>
      <MobileHeader
        adapter={props.adapter}
        onBrowse={() => props.onObjectDrawerOpenChange(true)}
      />
      <aside
        className="vk-product-sidebar"
        aria-label={t('appShell.navigation.sidebar')}
      >
        <Identity adapter={props.adapter} />
        <PrimaryNavigation
          adapter={props.adapter}
          activeModule={props.activeModule}
          onSearch={props.onSearch}
        />
        <ObjectLists {...props} />
        <SystemZone adapter={props.adapter} />
      </aside>

      <aside
        className="vk-product-rail"
        aria-label={t('appShell.navigation.rail')}
      >
        <span className="vk-shell-identity__mark">VK</span>
        <PrimaryNavigation
          adapter={props.adapter}
          activeModule={props.activeModule}
          onSearch={props.onSearch}
          iconOnly
          onOpenObjects={() => props.onObjectDrawerOpenChange(true)}
        />
        <div className="vk-product-rail__system">
          {updateNotice && (
            <button
              type="button"
              className="vk-product-rail__update"
              data-update-phase={updateNotice.phase}
              aria-label={updateNoticeLabel}
              title={updateNoticeLabel}
              onClick={updateNotice.open}
            >
              <RefreshCw aria-hidden="true" size={18} />
            </button>
          )}
          <button
            type="button"
            className="vk-product-rail__settings"
            aria-label={t('appShell.system.settings')}
            title={t('appShell.system.settings')}
            onClick={props.adapter.openSettings}
          >
            <Settings aria-hidden="true" size={18} />
          </button>
        </div>
      </aside>

      {props.objectDrawerOpen && <ObjectDrawer {...props} />}

      <nav
        className="vk-bottom-nav"
        aria-label={t('appShell.navigation.mobile')}
      >
        {MODULES.map(({ id, labelKey, icon: Icon }) => {
          const label = t(labelKey);
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
