import { logger } from '../utils/logger.js';
import { getPage } from '../browser/connect.js';
import { jobQueue } from '../queue/job-queue.js';
import { FlowError, ErrorCodes } from '../utils/errors.js';
import { takeScreenshot } from '../utils/screenshots.js';
import { detectPageElements } from '../browser/safe-actions.js';
import { prepareDownload, findNewFiles, saveMetadata } from '../utils/file-manager.js';
import { ensureProjectInContext, navigateToSidebar } from '../navigation/project-navigator.js';
import { get } from '../utils/config.js';
import fs from 'fs';
import path from 'path';

function selectVideoModel(requested) {
  const available = get('videoModels', {});
  if (!requested || requested === 'auto') {
    return 'Veo 3.1 - Fast';
  }
  if (requested === 'quality' || requested === 'premium') return 'Veo 3.1 - Quality';
  if (requested === 'fast' || requested === 'speed') return 'Veo 3.1 - Fast';
  if (requested === 'lite' || requested === 'test') return 'Veo 3.1 - Lite';
  if (requested === 'flash' || requested === 'simple') return 'Omni Flash';
  if (available[requested]) return requested;
  return null;
}

export async function handleGenerateVideo(args) {
  const job = jobQueue.createJob('video_generation', {
    prompt: args.prompt,
    model: args.model || 'auto',
    ratio: args.ratio || '16:9',
    duration: args.duration || '4s',
    quantity: args.quantity || 1,
    outputFolder: args.output_folder,
    useCharacter: args.use_character,
    useScene: args.use_scene,
    references: args.references,
    ingredients: args.ingredients,
    project_name: args.project_name,
    campaign: args.campaign,
  });

  try {
    jobQueue.startJob(job.id);
    const page = getPage();

    // Ensure we're in a project context
    await ensureProjectInContext(page, {
      name: args.project_name,
      campaign: args.campaign,
    });

    // Select model
    const model = selectVideoModel(args.model);
    if (!model) {
      const available = Object.keys(get('videoModels', {}));
      throw new FlowError(ErrorCodes.MODEL_NOT_AVAILABLE,
        `Video model "${args.model}" not available. Available: ${available.join(', ')}`,
        { requested: args.model, available });
    }
    logger.info('Using video model', { model });

    // Try to find video UI — look for textarea, selectors, etc.
    const elements = await detectPageElements(page);
    logger.info('Page elements in project for video', {
      buttons: elements.buttons.length,
      inputs: elements.inputs.length,
    });

    // Find prompt input — try current view first, then navigate sidebar
    let promptInput = null;
    const promptCandidates = [
      page.locator('textarea:visible, [contenteditable="true"]:visible').first(),
      page.locator('textarea').first(),
      page.locator('[contenteditable="true"]').first(),
    ];

    for (const candidate of promptCandidates) {
      if (await candidate.isVisible().catch(() => false)) {
        promptInput = candidate;
        break;
      }
    }

    if (!promptInput) {
      logger.info('No prompt found on current view, trying sidebar navigation');
      await navigateToSidebar(page, 'Outils');
      await page.waitForTimeout(2000);

      for (const candidate of promptCandidates) {
        if (await candidate.isVisible().catch(() => false)) {
          promptInput = candidate;
          break;
        }
      }
    }

    if (!promptInput) {
      await takeScreenshot(page, 'no-prompt-input-video');
      throw new FlowError(ErrorCodes.UNKNOWN_UI_CHANGE, 'Could not find prompt input for video');
    }

    // Model selection dropdown
    try {
      const modelLocator = page.locator('button:has-text("Omni"), button:has-text("Veo"), [class*="model"] button').first();
      if (await modelLocator.isVisible().catch(() => false)) {
        await modelLocator.click();
        await page.waitForTimeout(500);
        const optLocator = page.locator(`text="${model}"`).first();
        if (await optLocator.isVisible().catch(() => false)) {
          await optLocator.click();
          await page.waitForTimeout(500);
        } else {
          await page.keyboard.press('Escape');
        }
      }
    } catch (err) {
      logger.warn('Could not select video model', { error: err.message });
    }

    // Select ratio
    const ratios = get('videoRatios', ['9:16', '16:9']);
    const ratio = args.ratio || '16:9';
    if (!ratios.includes(ratio)) {
      throw new FlowError(ErrorCodes.RATIO_NOT_AVAILABLE, `Ratio ${ratio} not available for video`);
    }
    try {
      const ratioBtn = page.locator(`button:has-text("${ratio}")`).first();
      if (await ratioBtn.isVisible().catch(() => false)) {
        await ratioBtn.click();
        await page.waitForTimeout(500);
      }
    } catch { /* ok */ }

    // Select duration
    const durations = get('durations', ['4s', '6s', '8s', '10s']);
    const duration = args.duration || '4s';
    if (!durations.includes(duration)) {
      logger.warn('Duration not available, using 4s', { requested: duration });
    }
    try {
      const durBtn = page.locator(`button:has-text("${duration}")`).first();
      if (await durBtn.isVisible().catch(() => false)) {
        await durBtn.click();
        await page.waitForTimeout(500);
      }
    } catch { /* ok */ }

    // Select quantity
    const qty = Math.min(Math.max(args.quantity || 1, 1), 4);
    try {
      const qtyBtn = page.locator(`button:has-text("x${qty}")`).first();
      if (await qtyBtn.isVisible().catch(() => false)) {
        await qtyBtn.click();
        await page.waitForTimeout(500);
      }
    } catch { /* ok */ }

    // Fill prompt
    await promptInput.click();
    await promptInput.fill('');
    await page.waitForTimeout(200);
    await promptInput.type(args.prompt, { delay: 20 });
    await page.waitForTimeout(500);

    await takeScreenshot(page, 'video-ready-to-generate');

    // Video generation is paid — only clicks Generate when explicitly confirmed.
    if (args.auto_confirm !== true) {
      logger.info('Video generation setup complete — not clicking generate (paid feature)');

      saveMetadata(job.id, {
        type: 'video',
        model,
        ratio,
        duration,
        quantity: qty,
        prompt: args.prompt,
        status: 'ready_for_confirmation',
        note: 'Video generation is a paid feature. Call again with auto_confirm=true to proceed.',
      });

      jobQueue.completeJob(job.id, {
        status: 'ready_for_confirmation',
        type: 'video',
        account: get('expectedAccount'),
        model_used: model,
        ratio,
        duration,
        quantity: qty,
        prompt: args.prompt,
        message: 'Video generation setup complete. Call again with auto_confirm=true to consume credits and generate.',
        screenshot: await takeScreenshot(page, 'video-ready'),
      });

      return jobQueue.getJob(job.id).result;
    }

    logger.info('auto_confirm=true — looking for Generate button');
    const generateBtnLocator = page.locator(
      '.generate-icon-button, [aria-label="Start generation"], button:has-text("Generate")'
    ).first();
    const generateBtnReady = await generateBtnLocator.waitFor({ state: 'visible', timeout: 20000 }).then(() => true).catch(() => false);
    if (!generateBtnReady) {
      await takeScreenshot(page, 'video-no-generate-btn');
      throw new FlowError(ErrorCodes.GENERATION_BUTTON_DISABLED, 'Generate button not found');
    }
    if (await generateBtnLocator.isDisabled().catch(() => false)) {
      await takeScreenshot(page, 'video-generate-disabled');
      throw new FlowError(ErrorCodes.GENERATION_BUTTON_DISABLED, 'Generate button is disabled');
    }

    logger.info('⚠️⚠️⚠️ Clicking Generate — credits will be consumed (video)');
    await generateBtnLocator.click();

    // Some flows show an Agent "Accepter/Approve" confirmation before starting.
    const acceptTimeoutMs = get('agentResponseTimeoutMs', 5000);
    const acceptStart = Date.now();
    while (Date.now() - acceptStart < acceptTimeoutMs) {
      const pageText = await page.evaluate(() => document.body.innerText).catch(() => '');
      if (pageText.includes('Accepter') || pageText.includes('Approve')) {
        const acceptBtn = page.locator('button').filter({ hasText: /Accepter|Approve/ }).first();
        await acceptBtn.click();
        logger.info('Generation confirmed via Agent');
        break;
      }
      await page.waitForTimeout(500);
    }

    await page.waitForTimeout(2000);
    const postClickScreenshot = await takeScreenshot(page, 'video-generating');

    saveMetadata(job.id, {
      type: 'video',
      model,
      ratio,
      duration,
      quantity: qty,
      prompt: args.prompt,
      status: 'generating',
    });

    jobQueue.completeJob(job.id, {
      status: 'generating',
      type: 'video',
      account: get('expectedAccount'),
      model_used: model,
      ratio,
      duration,
      quantity: qty,
      prompt: args.prompt,
      message: 'Generate clicked — video is rendering in Google Flow. Use flow_status or flow_download_latest to check progress/retrieve it.',
      screenshot: postClickScreenshot,
    });

    return jobQueue.getJob(job.id).result;
  } catch (err) {
    jobQueue.failJob(job.id, err);
    try { await takeScreenshot(getPage(), 'generate-video-error'); } catch { /* browser may be disconnected */ }
    throw err;
  }
}
