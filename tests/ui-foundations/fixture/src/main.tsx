import * as React from 'react';
import { createRoot } from 'react-dom/client';
import {
  FloatingPanel,
  FloatingPanelBody,
  FloatingPanelDescription,
  FloatingPanelHeader,
  FloatingPanelTitle,
} from '../../../../packages/ui/src/components/FloatingPanel';
import { Button } from '../../../../packages/ui/src/components/Button';
import { Input } from '../../../../packages/ui/src/components/Input';
import { SplitLayout } from '../../../../packages/ui/src/components/SplitLayout';
import { CrashScreen } from '../../../../packages/ui/src/components/CrashScreen';
import {
  createBrowserThemeController,
  type ThemeMode,
} from '../../../../packages/ui/src/lib/theme';
import '../../../../packages/ui/src/styles/tokens.css';
import './style.css';

const root = document.documentElement;
const bootstrapSnapshot = {
  mode: root.dataset.themeMode,
  theme: root.dataset.theme,
  colorScheme: root.style.colorScheme,
};

const createdController = createBrowserThemeController();

if (!createdController) {
  throw new Error('Theme controller was not created in the browser fixture');
}

const controller = createdController;

function getRequiredElement(testId: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(
    `[data-testid="${testId}"]`
  );
  if (!element) {
    throw new Error(`Theme fixture output is missing: ${testId}`);
  }
  return element;
}

const bootstrapOutput = getRequiredElement('bootstrap-snapshot');
const modeOutput = getRequiredElement('controller-mode');
const effectiveThemeOutput = getRequiredElement('effective-theme');
const mountCountOutput = getRequiredElement('mount-count');

bootstrapOutput.textContent = JSON.stringify(bootstrapSnapshot);

const mountCount = Number(root.dataset.fixtureMountCount ?? '0') + 1;
root.dataset.fixtureMountCount = String(mountCount);
mountCountOutput.textContent = String(mountCount);

if (window.location.pathname === '/') {
  window.history.replaceState(
    { fixture: 'theme-foundations' },
    '',
    '/workspace/session-42?fixture=theme#transcript'
  );
}

function renderControllerState() {
  modeOutput.textContent = controller.getMode();
  effectiveThemeOutput.textContent = controller.getEffectiveTheme();
}

document
  .querySelectorAll<HTMLButtonElement>('[data-theme-mode]')
  .forEach((button) => {
    button.addEventListener('click', () => {
      controller.setMode(button.dataset.themeMode as ThemeMode);
      renderControllerState();
    });
  });

renderControllerState();

function FloatingPanelHarness() {
  const [open, setOpen] = React.useState(false);
  const [autoFocus, setAutoFocus] = React.useState(false);

  const openPanel = (shouldAutoFocus: boolean) => {
    setAutoFocus(shouldAutoFocus);
    setOpen(true);
  };

  return (
    <section aria-labelledby="floating-panel-contract-title">
      <h2 id="floating-panel-contract-title">Floating panel contract</h2>
      <div className="fixture-actions">
        <button
          type="button"
          data-testid="panel-trigger"
          onClick={() => openPanel(false)}
        >
          Open default panel
        </button>
        <button
          type="button"
          data-testid="canvas-target"
          onClick={() => openPanel(false)}
        >
          Canvas target
        </button>
        <button
          type="button"
          data-testid="autofocus-trigger"
          onClick={() => openPanel(true)}
        >
          Open autofocus panel
        </button>
        <button
          type="button"
          data-testid="canvas-close-panel"
          onClick={() => setOpen(false)}
        >
          Focus canvas and close panel
        </button>
      </div>

      <FloatingPanel
        open={open}
        onOpenChange={setOpen}
        autoFocus={autoFocus}
        aria-labelledby="fixture-panel-title"
        aria-describedby="fixture-panel-description"
        contentClassName="fixture-floating-panel-content"
      >
        <FloatingPanelHeader>
          <FloatingPanelTitle id="fixture-panel-title">
            Node configuration
          </FloatingPanelTitle>
          <FloatingPanelDescription id="fixture-panel-description">
            Non-modal configuration that keeps the canvas available.
          </FloatingPanelDescription>
        </FloatingPanelHeader>
        <FloatingPanelBody>
          <label>
            Node title
            <input data-testid="panel-input" defaultValue="Review changes" />
          </label>
        </FloatingPanelBody>
      </FloatingPanel>
    </section>
  );
}

function SplitLayoutHarness() {
  const [secondarySize, setSecondarySize] = React.useState(320);
  const [resizeEndSize, setResizeEndSize] = React.useState<number | null>(null);

  return (
    <section aria-labelledby="split-layout-contract-title">
      <h2 id="split-layout-contract-title">Split layout contract</h2>
      <output data-testid="secondary-size">{secondarySize}</output>
      <output data-testid="resize-end-size">{resizeEndSize ?? 'none'}</output>
      <SplitLayout
        data-testid="split-layout"
        primary={<div>Primary work area</div>}
        secondary={<div>Secondary inspector</div>}
        secondarySize={secondarySize}
        onSecondarySizeChange={setSecondarySize}
        minSecondarySize={240}
        maxSecondarySize={400}
        resizeStep={40}
        separatorLabel="Resize test inspector"
        secondaryId="fixture-secondary-pane"
        onResizeEnd={setResizeEndSize}
      />
    </section>
  );
}

function InteractionContractHarness() {
  const [childCaptureCount, setChildCaptureCount] = React.useState(0);
  const [childClickCount, setChildClickCount] = React.useState(0);
  const [buttonCaptureCount, setButtonCaptureCount] = React.useState(0);

  return (
    <section aria-labelledby="interaction-contract-title">
      <h2 id="interaction-contract-title">Interaction contracts</h2>
      <Button
        asChild
        disabled
        onClickCapture={() => setButtonCaptureCount((count) => count + 1)}
      >
        <a
          href="#disabled-button-should-not-navigate"
          data-testid="disabled-as-child"
          onClickCapture={() => setChildCaptureCount((count) => count + 1)}
          onClick={() => setChildClickCount((count) => count + 1)}
        >
          Disabled slotted action
        </a>
      </Button>
      <output data-testid="child-capture-count">{childCaptureCount}</output>
      <output data-testid="child-click-count">{childClickCount}</output>
      <output data-testid="button-capture-count">{buttonCaptureCount}</output>

      <label htmlFor="invalid-agent-endpoint">Agent endpoint</label>
      <Input
        id="invalid-agent-endpoint"
        data-testid="invalid-input"
        invalid
        aria-describedby="invalid-agent-endpoint-error"
        defaultValue="not-a-valid-endpoint"
      />
      <p id="invalid-agent-endpoint-error">Enter a valid endpoint.</p>

      <div className="fixture-motion-probe" data-testid="motion-probe" />
    </section>
  );
}

function CrashScreenHarness() {
  const [reloadCount, setReloadCount] = React.useState(0);

  return (
    <section aria-labelledby="crash-screen-contract-title">
      <h2 id="crash-screen-contract-title">Crash screen contract</h2>
      <output data-testid="crash-reload-count">{reloadCount}</output>
      <div data-testid="crash-screen-harness">
        <CrashScreen
          error="Fixture crash"
          componentStack="\n at Fixture"
          onReload={() => setReloadCount((count) => count + 1)}
        />
      </div>
    </section>
  );
}

const componentRoot = document.getElementById('component-root');
if (!componentRoot) {
  throw new Error('Component contract root is missing');
}

createRoot(componentRoot).render(
  <React.StrictMode>
    <FloatingPanelHarness />
    <SplitLayoutHarness />
    <InteractionContractHarness />
    <CrashScreenHarness />
  </React.StrictMode>
);
