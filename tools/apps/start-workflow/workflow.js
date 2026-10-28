import {
  fingerprint, LOCALE_MODE, summarize, validateProject,
} from './model.js';

export class ReviewRequired extends Error {}

async function reconcile(item, io) {
  const destination = await io.readDestination(item.destination);
  if (!destination) return false;
  if (item.outputHash && await fingerprint(destination.content) === item.outputHash) {
    item.status = 'complete';
    item.savedDate = Date.now();
    item.error = '';
    return true;
  }
  throw new ReviewRequired(`Destination already exists or changed: ${item.destination}. This POC does not overwrite existing content.`);
}

async function executeItem(item, project, io, checkpoint) {
  if (await reconcile(item, io)) return;
  const source = await io.readSource(item.source);
  if (!source || await fingerprint(source.content) !== item.sourceHash) {
    throw new ReviewRequired(`Source changed or was removed: ${item.source}. Create a new workflow for the new revision.`);
  }
  item.attempts += 1;
  item.status = 'translating';
  item.error = '';
  delete item.outputHash;
  await checkpoint();
  const output = await io.translate(source.content, item.code);
  if (typeof output !== 'string' || !output.trim()) throw new Error('Google returned no translated content.');
  item.outputHash = await fingerprint(output);
  item.status = 'saving';
  await checkpoint();
  const currentSource = await io.readSource(item.source);
  if (!currentSource || await fingerprint(currentSource.content) !== item.sourceHash) {
    throw new ReviewRequired(`Source changed during translation: ${item.source}. No destination was written.`);
  }
  // A destination may have been created while Google was processing.
  if (await reconcile(item, io)) return;
  try {
    await io.saveDestination(item.destination, output);
    if (!await reconcile(item, io)) throw new Error('The destination could not be read after saving.');
  } catch (error) {
    if (error instanceof ReviewRequired) throw error;
    item.status = 'save-unconfirmed';
    throw new Error(`Save not confirmed for ${item.destination}: ${error.message}. Retry checks the saved content before translating again.`);
  }
}

async function assertSource(item, io) {
  const source = await io.readSource(item.source);
  if (!source || await fingerprint(source.content) !== item.sourceHash) {
    throw new ReviewRequired(`Source changed or was removed: ${item.source}. Create a new workflow for the new revision.`);
  }
  return source.content;
}

async function matchesDestination(item, hash, io) {
  const destination = await io.readDestination(item.destination);
  return Boolean(destination && await fingerprint(destination.content) === hash);
}

async function executeLocaleItem(item, io, checkpoint) {
  if (item.outputHash && await matchesDestination(item, item.outputHash, io)) {
    item.status = 'complete';
    item.rolloutStatus = 'complete';
    item.savedDate = Date.now();
    item.error = '';
    return;
  }
  const source = await assertSource(item, io);
  item.attempts += 1;
  item.error = '';
  delete item.outputHash;
  delete item.savedDate;
  item.status = 'queued';
  const rollout = await io.prepareRollout(source);
  item.rolloutHash = await fingerprint(rollout);
  const alreadyRolledOut = item.rolloutStatus !== 'queued'
    && await matchesDestination(item, item.rolloutHash, io);
  if (!alreadyRolledOut) {
    item.status = 'rolling-out';
    item.rolloutStatus = 'saving';
    await checkpoint();
    await assertSource(item, io);
    try {
      await io.saveDestination(item.destination, rollout);
      if (!await matchesDestination(item, item.rolloutHash, io)) {
        throw new Error('The saved rollout does not match the source copy.');
      }
    } catch (error) {
      item.rolloutStatus = 'save-unconfirmed';
      throw new Error(`Rollout save not confirmed for ${item.destination}: ${error.message}. Retry reconciles the destination before continuing.`);
    }
  }
  item.rolloutStatus = 'complete';
  item.rolloutSavedDate = Date.now();
  if (!item.translate) {
    item.outputHash = item.rolloutHash;
    item.status = 'complete';
    item.savedDate = Date.now();
    return;
  }
  item.status = 'translating';
  await checkpoint();
  const output = await io.translate(rollout, item.translationCode);
  if (typeof output !== 'string' || !output.trim()) throw new Error('Google returned no translated content.');
  item.outputHash = await fingerprint(output);
  item.status = 'saving';
  await checkpoint();
  await assertSource(item, io);
  try {
    await io.saveDestination(item.destination, output);
    if (!await matchesDestination(item, item.outputHash, io)) {
      throw new Error('The saved translation does not match the translated output.');
    }
  } catch (error) {
    item.status = 'save-unconfirmed';
    throw new Error(`Translation save not confirmed for ${item.destination}: ${error.message}. Retry reconciles the saved content first.`);
  }
  item.status = 'complete';
  item.savedDate = Date.now();
}

/**
 * Status writes are a hard gate: do not continue content writes when progress
 * cannot be persisted. Completed tasks are never translated or written again.
 */
export async function runProject(project, config, io, {
  shouldStop = () => false, onChange = () => {},
} = {}) {
  validateProject(project, project.org, project.site);
  if (await fingerprint(JSON.stringify(config.sheets)) !== project.workflow.configHash) {
    throw new Error('Translation configuration changed. Create a new workflow using the current configuration.');
  }
  if (project.workflow.mode === LOCALE_MODE && project.langs.some((lang) => !config.targets
    .some((target) => target.id === lang.id && target.location === lang.location
      && target.code === lang.code && target.translationCode === lang.translationCode
      && target.translate === lang.translate))) {
    throw new Error('Workflow targets do not match the configured locales. No content was written.');
  }
  let persistenceError;
  const checkpoint = async () => {
    summarize(project);
    onChange(project);
    try {
      await io.saveProject(project);
    } catch (error) {
      persistenceError = error;
      throw error;
    }
  };
  await checkpoint();
  // eslint-disable-next-line no-restricted-syntax -- Serialize writes and checkpoints.
  for (const item of project.workflow.items) {
    if (shouldStop()) break;
    if (item.status !== 'complete' && item.status !== 'needs-review') {
      try {
        // eslint-disable-next-line no-await-in-loop
        if (project.workflow.mode === LOCALE_MODE) {
          // eslint-disable-next-line no-await-in-loop
          await executeLocaleItem(item, io, checkpoint);
        } else {
          // eslint-disable-next-line no-await-in-loop
          await executeItem(item, project, io, checkpoint);
        }
      } catch (error) {
        if (persistenceError) {
          throw new Error(`Workflow status could not be saved. Execution stopped: ${persistenceError.message}. Reload the project to reconcile progress.`);
        }
        if (error instanceof ReviewRequired) item.status = 'needs-review';
        else if (item.status !== 'save-unconfirmed') item.status = 'failed';
        item.error = error.message;
      }
      // eslint-disable-next-line no-await-in-loop
      await checkpoint();
    }
  }
  return project;
}
