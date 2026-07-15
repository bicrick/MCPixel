/**
 * Direction-batch helpers: collapse 8 jobs into one queue/view unit.
 */

import { ACTIVE_STATUSES, bestUrl, isActive, sortedJobs, state } from "./state.js";

/** Compass reading order for the directions grid (2×4). */
export const DIRECTION_DISPLAY_ORDER = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

export function isDirectionBatch(job) {
  return Boolean(job?.extra?.direction_batch_id);
}

export function batchIdOf(job) {
  return job?.extra?.direction_batch_id || null;
}

export function siblingsForBatch(batchId) {
  if (!batchId) return [];
  return sortedJobs().filter((j) => j.extra?.direction_batch_id === batchId);
}

export function batchMaster(siblings) {
  return (
    siblings.find((j) => j.extra?.direction_role === "master") ||
    siblings.find((j) => j.extra?.direction === "S") ||
    siblings[0] ||
    null
  );
}

export function basePrompt(job) {
  if (job?.extra?.base_prompt) return job.extra.base_prompt;
  const prompt = job?.prompt || "";
  const cut = prompt.indexOf("\n\nSame character");
  if (cut >= 0) return prompt.slice(0, cut).trim();
  return prompt.trim();
}

/**
 * @returns {"generating"|"completed"|"failed"|"partial"|"queued"|"cancelled"}
 */
export function aggregateBatchStatus(siblings) {
  if (!siblings.length) return "queued";
  const statuses = siblings.map((j) => j.status);
  const anyActive = statuses.some((s) => ACTIVE_STATUSES.has(s));
  const allDone = statuses.every((s) => s === "completed");
  const anyFailed = statuses.some((s) => s === "failed");
  const anyCancelled = statuses.some((s) => s === "cancelled");
  const allCancelled = statuses.every((s) => s === "cancelled");
  const allFailedOrCancelled = statuses.every(
    (s) => s === "failed" || s === "cancelled"
  );

  if (anyActive) return "generating";
  if (allDone) return "completed";
  if (allCancelled) return "cancelled";
  if (allFailedOrCancelled && anyFailed) return "failed";
  if ((anyFailed || anyCancelled) && statuses.some((s) => s === "completed")) {
    return "partial";
  }
  if (anyFailed) return "failed";
  return "queued";
}

export function batchProgressLabel(siblings) {
  const done = siblings.filter((j) => j.status === "completed").length;
  const active = siblings.filter((j) => isActive(j.status)).length;
  const failed = siblings.filter(
    (j) => j.status === "failed" || j.status === "cancelled"
  ).length;
  const total = siblings.length || 8;
  if (active) return `${done}/${total} done · ${active} active`;
  if (failed && done) return `${done}/${total} done · ${failed} failed`;
  if (failed && !done) return `${failed}/${total} failed`;
  return `${done}/${total} done`;
}

export function batchProgressPercent(siblings) {
  if (!siblings.length) return 0;
  const done = siblings.filter((j) => j.status === "completed").length;
  return Math.round((done / siblings.length) * 100);
}

export function batchThumbJob(siblings) {
  const master = batchMaster(siblings);
  if (master && bestUrl(master)) return master;
  return siblings.find((j) => bestUrl(j)) || master || siblings[0] || null;
}

export function batchFingerprint(siblings) {
  return siblings
    .map(
      (j) =>
        `${j.id}:${j.status}:${j.updated_at || ""}:${bestUrl(j) || ""}:${j.extra?.direction || ""}`
    )
    .join(";");
}

/**
 * Collapse direction siblings into queue rows; leave other jobs as-is.
 * Input should be the full sorted job list (not pre-filtered by status).
 * @returns {Array<{kind:"job", job:object}|{kind:"batch", batchId:string, master:object, siblings:object[]}>}
 */
export function queueEntriesFromJobs(jobs) {
  const seen = new Set();
  const entries = [];
  for (const job of jobs) {
    const bid = batchIdOf(job);
    if (!bid) {
      entries.push({ kind: "job", job });
      continue;
    }
    if (seen.has(bid)) continue;
    seen.add(bid);
    const siblings = jobs.filter((j) => j.extra?.direction_batch_id === bid);
    const master = batchMaster(siblings);
    if (!master) continue;
    entries.push({ kind: "batch", batchId: bid, master, siblings });
  }
  return entries;
}

export function jobByDirection(siblings, code) {
  return siblings.find((j) => j.extra?.direction === code) || null;
}

export function isBatchRowSelected(batchId, siblings) {
  if (state.currentBatchId && state.currentBatchId === batchId) return true;
  if (state.currentJobId && siblings.some((j) => j.id === state.currentJobId)) {
    return true;
  }
  return false;
}
