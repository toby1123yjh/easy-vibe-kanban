import { expect, test } from '@playwright/test';

test('1000-message timeline mounts at most 200 message rows', async ({
  page,
}) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: '1000-message conversation' })
  ).toBeVisible();

  const mountedAtTop = await page.getByTestId('message-row').count();
  console.log(`1000-message top mounted rows: ${mountedAtTop}`);
  expect(mountedAtTop).toBeGreaterThan(0);
  expect(mountedAtTop).toBeLessThanOrEqual(200);

  const scroll = page.getByTestId('conversation-scroll');
  await scroll.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await page.waitForTimeout(100);

  const mountedAtBottom = await page.getByTestId('message-row').count();
  console.log(`1000-message bottom mounted rows: ${mountedAtBottom}`);
  expect(mountedAtBottom).toBeLessThanOrEqual(200);
  await expect(page.getByText('Message 1000')).toBeVisible();
});

test('4x CPU typing and scrolling stay within the 100ms interaction budget', async ({
  page,
}) => {
  const client = await page.context().newCDPSession(page);
  await client.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: '1000-message conversation' })
  ).toBeVisible();

  await page.evaluate(() => {
    const durations: Array<{ name: string; duration: number }> = [];
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        durations.push({ name: entry.name, duration: entry.duration });
      }
    });
    observer.observe({ type: 'event', buffered: true, durationThreshold: 0 });
    const scope = window as Window & {
      __inpObserver?: PerformanceObserver;
      __inpDurations?: typeof durations;
    };
    scope.__inpObserver = observer;
    scope.__inpDurations = durations;
  });

  await page.getByTestId('interaction-input').click();
  await page.keyboard.type('cpu throttled interaction sample');
  await page.getByTestId('conversation-scroll').hover();
  await page.mouse.wheel(0, 1200);
  await page.waitForTimeout(150);

  const metric = await page.evaluate(() => {
    const scope = window as Window & {
      __inpObserver?: PerformanceObserver;
      __inpDurations?: Array<{ name: string; duration: number }>;
    };
    scope.__inpObserver?.disconnect();
    const relevant = (scope.__inpDurations ?? []).filter((entry) =>
      ['keydown', 'input', 'wheel'].includes(entry.name)
    );
    return {
      samples: relevant.length,
      maxDuration: relevant.reduce(
        (maximum, entry) => Math.max(maximum, entry.duration),
        0
      ),
    };
  });
  console.log(`4x CPU Event Timing: ${JSON.stringify(metric)}`);
  expect(
    metric.samples,
    'Event Timing produced no interaction samples'
  ).toBeGreaterThan(0);
  expect(metric.maxDuration).toBeLessThanOrEqual(100);
});
