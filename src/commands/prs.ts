import { bold, cyan, gray, green, yellow, red, magenta } from '../utils/colors.ts';
import type { Command, CommandContext, PullRequest } from '../types/index.ts';
import { listPullRequests, getPullRequest } from '../utils/github.ts';
import { checkAndSwitchWorktree } from './worktrees.ts';
import { getNote, isFlagged, getFlaggedItems, isPinned } from '../utils/config.ts';
import { selectPrompt } from '../utils/ui.ts';

export const prCommand: Command = {
  name: 'pr',
  description: 'View or select a pull request',
  args: [
    { name: 'number|list', description: 'PR number or list', required: false },
    { name: '--author|--reviewer user', description: 'Filter by user', required: false },
  ],
  async execute(args: string[], context: CommandContext) {
    if (!context.config.activeRepository) {
      console.log(yellow('No repository selected. Use /repo select first.'));
      return;
    }

    const [first, ...rest] = args;

    if (!first) {
      // Show interactive PR selector
      await selectPRInteractive(context);
      return;
    }

    if (first === 'list') {
      await listPRsCommand(rest, context);
      return;
    }

    // Try to parse as number
    const number = parseInt(first, 10);
    if (!isNaN(number)) {
      await selectPR(number, context);
      return;
    }

    console.log(red(`Invalid argument: ${first}`));
    console.log('Usage: /pr [list|<number>] [--author|--reviewer <user>]');
  },
};

export const prsCommand: Command = {
  name: 'prs',
  aliases: ['pulls'],
  description: 'List pull requests in the active repository',
  args: [
    { name: 'options', description: '--author|--reviewer <user> | --flagged', required: false },
  ],
  async execute(args: string[], context: CommandContext) {
    if (!context.config.activeRepository) {
      console.log(yellow('No repository selected. Use /repo select first.'));
      return;
    }
    await listPRsCommand(args, context);
  },
};

async function selectPRInteractive(context: CommandContext): Promise<void> {
  const repo = context.config.activeRepository!;
  
  console.log(gray(`\nFetching PRs from ${repo.owner}/${repo.repo}...\n`));

  try {
    const prs = await listPullRequests(repo);
    
    if (prs.length === 0) {
      console.log(yellow('No pull requests found.'));
      return;
    }

    // Check which PRs have notes, flags, and pins
    const prsWithNotes = new Set<number>();
    const flaggedPRs = new Set<number>();
    const pinnedPRs = new Set<number>();
    for (const pr of prs) {
      const note = await getNote(repo.owner, repo.repo, pr.number);
      if (note) prsWithNotes.add(pr.number);
      if (isFlagged(context.config, repo.owner, repo.repo, pr.number)) {
        flaggedPRs.add(pr.number);
      }
      if (isPinned(context.config, repo.owner, repo.repo, pr.number)) {
        pinnedPRs.add(pr.number);
      }
    }

    // Sort PRs with pinned at top
    const sortedPRs = [...prs].sort((a, b) => {
      const aPinned = pinnedPRs.has(a.number);
      const bPinned = pinnedPRs.has(b.number);
      if (aPinned && !bPinned) return -1;
      if (!aPinned && bPinned) return 1;
      return 0;
    });

    const choices = sortedPRs.map(pr => ({
      name: formatPRChoice(pr, context.config.activePR, prsWithNotes.has(pr.number), flaggedPRs.has(pr.number), pinnedPRs.has(pr.number)),
      value: pr.number,
    }));

    try {
      const selected = await selectPrompt({
        message: 'Select a pull request',
        choices,
      });

      if (selected) {
        await selectPR(selected, context);
      }
    } catch {
      // User cancelled
    }
  } catch (error) {
    if (error instanceof Error) {
      console.log(red(`Error: ${error.message}`));
    }
  }
}

async function listPRsCommand(args: string[], context: CommandContext): Promise<void> {
  const repo = context.config.activeRepository!;
  
  // Parse options
  let author: string | undefined;
  let reviewer: string | undefined;
  let flaggedOnly = false;
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--author' && args[i + 1]) {
      author = args[i + 1];
      if (author === 'me') {
        author = context.config.username || undefined;
        if (!author) {
          console.log(yellow('Username not configured. Use /config username <name> first.'));
          return;
        }
      }
      i++;
    } else if (args[i] === '--reviewer' && args[i + 1]) {
      reviewer = args[i + 1];
      if (reviewer === 'me') {
        reviewer = context.config.username || undefined;
        if (!reviewer) {
          console.log(yellow('Username not configured. Use /config username <name> first.'));
          return;
        }
      }
      i++;
    } else if (args[i] === '--flagged' || args[i] === '-f') {
      flaggedOnly = true;
    }
  }

  // If flagged only, show flagged PRs
  if (flaggedOnly) {
    const flaggedItems = getFlaggedItems(context.config, repo.owner, repo.repo, 'pr');
    
    if (flaggedItems.length === 0) {
      console.log(yellow('\nNo flagged PRs found.'));
      console.log(gray('Use /flag to flag the active PR.\n'));
      return;
    }

    console.log(bold('\n⭐ Flagged PRs:\n'));
    
    for (const flagged of flaggedItems) {
      const pr = await getPullRequest(repo, flagged.number);
      if (pr) {
        const note = await getNote(repo.owner, repo.repo, pr.number);
        const pinned = isPinned(context.config, repo.owner, repo.repo, pr.number);
        displayPRLine(pr, context.config.activePR, !!note, true, pinned);
      }
    }
    console.log();
    return;
  }

  console.log(gray(`\nFetching PRs from ${repo.owner}/${repo.repo}...\n`));

  try {
    const prs = await listPullRequests(repo, { author, reviewer });
    
    if (prs.length === 0) {
      console.log(yellow('No pull requests found.'));
      return;
    }

    // Check which PRs have notes, flags, and pins
    const prsWithNotes = new Set<number>();
    const flaggedPRs = new Set<number>();
    const pinnedPRs = new Set<number>();
    for (const pr of prs) {
      const note = await getNote(repo.owner, repo.repo, pr.number);
      if (note) prsWithNotes.add(pr.number);
      if (isFlagged(context.config, repo.owner, repo.repo, pr.number)) {
        flaggedPRs.add(pr.number);
      }
      if (isPinned(context.config, repo.owner, repo.repo, pr.number)) {
        pinnedPRs.add(pr.number);
      }
    }

    // Sort PRs with pinned at top
    const sortedPRs = [...prs].sort((a, b) => {
      const aPinned = pinnedPRs.has(a.number);
      const bPinned = pinnedPRs.has(b.number);
      if (aPinned && !bPinned) return -1;
      if (!aPinned && bPinned) return 1;
      return 0;
    });

    for (const pr of sortedPRs) {
      displayPRLine(pr, context.config.activePR, prsWithNotes.has(pr.number), flaggedPRs.has(pr.number), pinnedPRs.has(pr.number));
    }
    console.log();
  } catch (error) {
    if (error instanceof Error) {
      console.log(red(`Error: ${error.message}`));
    }
  }
}

async function selectPR(number: number, context: CommandContext): Promise<void> {
  const repo = context.config.activeRepository!;
  
  console.log(gray(`\nFetching PR #${number}...\n`));

  const pr = await getPullRequest(repo, number);
  if (!pr) {
    console.log(red(`PR #${number} not found`));
    return;
  }

  context.config.activePR = number;
  context.config.activeIssue = null;
  await context.saveConfig();

  displayPR(pr);

  // Check if worktree exists and switch to it
  await checkAndSwitchWorktree(number, context);
}

function formatPRChoice(pr: PullRequest, activeNumber: number | null, hasNotes: boolean = false, isFlagged: boolean = false, isPinned: boolean = false): string {
  const isActive = pr.number === activeNumber;
  const stateIcon = pr.state === 'OPEN' ? green('●') : pr.state === 'MERGED' ? magenta('●') : red('●');
  const prefix = isActive ? cyan('▶ ') : '  ';
  const pinIcon = isPinned ? magenta('📌 ') : '';
  const flagIcon = isFlagged ? yellow('⭐ ') : '';
  const draft = pr.isDraft ? gray(' [DRAFT]') : '';
  const labels = pr.labels.length > 0 ? gray(` [${pr.labels.slice(0, 2).join(', ')}]`) : '';
  const noteIcon = hasNotes ? yellow(' 📝') : '';
  
  return prefix + pinIcon + flagIcon + stateIcon + ' ' + bold(`#${pr.number}`) + ' ' + pr.title + draft + labels + noteIcon;
}

function displayPRLine(pr: PullRequest, activeNumber: number | null, hasNotes: boolean = false, isFlagged: boolean = false, isPinned: boolean = false): void {
  const isActive = pr.number === activeNumber;
  const stateColor = pr.state === 'OPEN' ? green : pr.state === 'MERGED' ? magenta : red;
  const prefix = isActive ? cyan('● ') : '  ';
  const pinIcon = isPinned ? magenta('📌 ') : '';
  const flagIcon = isFlagged ? yellow('⭐ ') : '';
  const draft = pr.isDraft ? gray(' [DRAFT]') : '';
  const noteIcon = hasNotes ? yellow(' 📝') : '';
  
  const labels = pr.labels.length > 0 
    ? gray(` [${pr.labels.join(', ')}]`) 
    : '';
  
  console.log(
    prefix +
    pinIcon +
    flagIcon +
    bold(`#${pr.number}`) + ' ' +
    stateColor(`[${pr.state}]`) + 
    draft + ' ' +
    pr.title +
    labels +
    noteIcon
  );
}

function displayPR(pr: PullRequest): void {
  console.log(bold(cyan(`#${pr.number}`)) + ' ' + bold(pr.title));
  console.log();
  
  const stateColor = pr.state === 'OPEN' ? green : pr.state === 'MERGED' ? magenta : red;
  console.log(gray('  State:   '), stateColor(pr.state) + (pr.isDraft ? gray(' (DRAFT)') : ''));
  console.log(gray('  Author:  '), pr.author);
  console.log(gray('  Branch:  '), cyan(pr.headBranch), gray('→'), cyan(pr.baseBranch));
  
  if (pr.reviewers.length > 0) {
    console.log(gray('  Reviewers:'), pr.reviewers.join(', '));
  }
  if (pr.labels.length > 0) {
    console.log(gray('  Labels:  '), pr.labels.join(', '));
  }
  console.log(gray('  URL:     '), cyan(pr.url));
  console.log();
}





