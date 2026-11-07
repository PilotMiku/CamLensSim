import { test as base } from '@playwright/test';
export { expect } from '@playwright/test';

/** Opt-in pixel budget for interaction/path integration tests on software GPUs.
 * This changes only the test page's CSS size. Production quality percentages,
 * ray counts and shaders remain intact; quality.spec.ts uses the full viewport.
 */
export const test = base.extend<{ renderWidth: number | undefined; canvasBudget: void }>({
  renderWidth: [undefined, { option: true }],
  canvasBudget: [async ({ page, renderWidth }, use) => {
    if (renderWidth !== undefined) {
      await page.addInitScript(width => {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(`.image-frame { max-width: ${width}px !important; }`);
        document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
      }, renderWidth);
    }
    await use();
  }, { auto: true }],
});
