import { z } from 'zod';

import { boardSchema, type DocumentData } from '@nexui/types';

import {
  CapabilityError,
  defineLookup,
  nameOf,
  resolveRef,
  type LookupContext,
  type LookupTool,
} from '#lib/capabilities';

import { NOT_A_BOARD, parseBoardUrl, postingFor } from './board-urls.ts';
import { BoardError, listPostings, postingSource, type BoardDeps, type Posting } from './boards.ts';
import { readJobsConfig } from './config.ts';
import { compact } from './parts.ts';
import { keywords, SearchError, searchBoards } from './search.ts';
import { quote } from './text.ts';

const OFF = 'Job board lookups are off.';
const BOARD_DOWN = 'The job board did not answer. Try again later.';

function boardDeps(ctx: LookupContext): BoardDeps | null {
  const { contact } = readJobsConfig(ctx.env);

  return contact ? { contact, fetch: ctx.fetch, cache: new Map() } : null;
}

// A posting as the model reads it: what `jobs.addRole` takes, and its text fenced as data.
function postingAnswer(found: Posting): Record<string, unknown> {
  return compact({
    title: found.title,
    company: { name: found.company, board: found.board },
    url: found.url,
    source: postingSource(found),
    location: found.location,
    workMode: found.workMode,
    salary: found.salary,
    postedAt: found.postedAt,
    posting: `<posting>${quote(found.text.slice(0, 3_000))}</posting>`,
  });
}

async function roleList(
  board: z.infer<typeof boardSchema>,
  deps: BoardDeps,
): Promise<Record<string, unknown>> {
  const postings = await listPostings(board, deps);

  return {
    roles: postings.slice(0, 30).map((found) =>
      compact({
        title: found.title,
        url: found.url,
        location: found.location,
        postedAt: found.postedAt,
      }),
    ),
  };
}

const webSearch = defineLookup({
  name: 'web.search',
  description:
    'Search the job boards (Greenhouse, Lever, Ashby) for recent postings. The query holds job ' +
    'titles, places and industries only, never resume text. Answers board URLs; read one with ' +
    'jobs_lookup before adding it.',
  input: z.strictObject({
    query: z.string().trim().min(3).max(120),
    sinceDays: z.number().int().min(1).max(30).optional().describe('Posted within; 7 by default'),
  }),
  perRun: 3,
  async execute(input, ctx) {
    const { searchKey } = readJobsConfig(ctx.env);

    if (!searchKey) {
      return { error: 'Web search is off.' };
    }

    try {
      const urls = await searchBoards(
        { objective: `Open job postings: ${input.query}`, queries: [keywords(input.query)] },
        { key: searchKey, fetch: ctx.fetch, now: ctx.now, sinceDays: input.sinceDays ?? 7 },
      );

      return { urls };
    } catch (error) {
      if (error instanceof SearchError) {
        return { error: 'The web search failed. Try again later.' };
      }

      throw error;
    }
  },
});

const jobsLookup = defineLookup({
  name: 'jobs.lookup',
  description:
    'Read one job posting from its URL (a Greenhouse, Lever or Ashby job page, or a careers ' +
    "page with gh_jid), or a company's open roles from its board. A posting comes back with " +
    'what jobs_addRole needs.',
  input: z.strictObject({
    url: z.string().min(1).max(2000).optional(),
    board: boardSchema.optional().describe("A company's board: provider and token"),
  }),
  perRun: 10,
  async execute(input, ctx) {
    const deps = boardDeps(ctx);

    if (!deps) {
      return { error: OFF };
    }

    try {
      if (input.board) {
        return await roleList(input.board, deps);
      }

      const link = input.url ? parseBoardUrl(input.url) : null;

      if (!link) {
        return { error: NOT_A_BOARD };
      }

      if (link.kind === 'board') {
        return await roleList(link.board, deps);
      }

      const found = await postingFor(link, deps);

      if (!found) {
        // An unconfirmed careers site is just another URL.
        return {
          error: link.kind === 'careers' ? NOT_A_BOARD : 'That posting is no longer on its board.',
        };
      }

      return postingAnswer(found);
    } catch (error) {
      if (error instanceof BoardError) {
        return { error: BOARD_DOWN };
      }

      throw error;
    }
  },
});

const documentRead = defineLookup({
  name: 'document.read',
  description: "Read a document's full text, such as the resume or a draft, by its ref.",
  input: z.strictObject({ ref: z.string().min(1).max(40) }),
  perRun: 5,
  async execute(input, ctx) {
    let object;

    try {
      object = resolveRef(ctx.refs, ctx.graph, input.ref);
    } catch (error) {
      if (error instanceof CapabilityError) {
        return { error: error.message };
      }

      throw error;
    }

    if (object.kind !== 'document') {
      return { error: `${nameOf(object)} is not a document.` };
    }

    const data = object.data as DocumentData;
    const tag = data.docType === 'resume' ? 'resume' : 'document';

    return { ref: input.ref, docType: data.docType, text: `<${tag}>${quote(data.body)}</${tag}>` };
  },
});

/** Job search's read-only tools (job search spec, section 5.5), with section 8's caps. */
export const JOB_SEARCH_LOOKUPS: readonly LookupTool[] = [webSearch, jobsLookup, documentRead];
