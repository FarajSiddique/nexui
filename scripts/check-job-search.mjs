#!/usr/bin/env node
/**
 * The live check of job search's web search (spikes note 3.3): ten Parallel searches over sample
 * criteria, each hit read from its board. It prints, per search, the hits, how many map to a
 * posting, how many are live, and the time. About $0.01. A manual gate, run only with the
 * founder's yes; not part of `pnpm test`.
 *
 * node --experimental-strip-types scripts/check-job-search.mjs
 *
 * Needs PARALLEL_API_KEY and NEXUI_CONTACT in apps/api/.env.local.
 */
import { parseBoardUrl, postingFor } from '../apps/api/src/lib/jobs/board-urls.ts';
import { readJobsConfig } from '../apps/api/src/lib/jobs/config.ts';
import { searchBoards, searchQuery } from '../apps/api/src/lib/jobs/search.ts';

process.loadEnvFile('apps/api/.env.local');

const config = readJobsConfig();

if (!config.searchKey || !config.contact) {
  console.error('Set PARALLEL_API_KEY and NEXUI_CONTACT in apps/api/.env.local.');
  process.exit(1);
}

const search = (roles, locations, workModes, industries = []) => ({
  roles,
  locations,
  workModes,
  industries,
});
const CRITERIA = [
  search(['Staff Product Manager'], ['London'], ['hybrid'], ['fintech']),
  search(['Senior Backend Engineer'], [], ['remote']),
  search(['Product Designer'], ['New York'], ['hybrid']),
  search(['Data Scientist'], ['Berlin'], ['onsite', 'hybrid']),
  search(['Engineering Manager'], ['Toronto'], ['remote', 'hybrid']),
  search(['Head of Growth'], ['San Francisco'], ['onsite']),
  search(['Product Manager'], [], ['remote'], ['climate']),
  search(['Machine Learning Engineer'], ['London'], ['hybrid']),
  search(['Technical Program Manager'], ['Seattle'], ['onsite']),
  search(['Solutions Engineer'], ['Dublin'], ['hybrid']),
];
let hits = 0;
let live = 0;

for (const criteria of CRITERIA) {
  const query = searchQuery(criteria);
  const started = Date.now();
  const urls = await searchBoards(query, { key: config.searchKey, fetch, now: new Date() });
  const links = urls.map(parseBoardUrl).filter((link) => link?.kind === 'posting');
  const deps = { contact: config.contact, fetch, cache: new Map() };
  const postings = await Promise.all(links.map((link) => postingFor(link, deps).catch(() => null)));
  const found = postings.filter(Boolean).length;

  hits += urls.length;
  live += found;
  console.log(
    `${query.queries.join(' | ')}: ${urls.length} hits, ${links.length} postings, ${found} live, ` +
      `${Date.now() - started} ms`,
  );
}

console.log(`\n${live} of ${hits} hits are live postings on their boards.`);
