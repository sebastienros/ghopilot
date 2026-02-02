import chalk from 'chalk';
import { search } from '@inquirer/prompts';
import type { Command, CommandContext, Issue } from '../types/index.js';
import { listIssues, getIssue } from '../utils/github.js';
import { checkAndSwitchWorktree } from './worktrees.js';
import { getNote, isFlagged, toggleFlag, getFlaggedItems, isPinned } from '../utils/config.js';

export const issueCommand: Command = {
  name: 'issue',
  description: 'View or select an issue',
  args: [
    { name: 'number|list', description: 'Issue number or list', required: false },
    { name: '--assignee user', description: 'Filter by assignee', required: false },
  ],
  async execute(args: string[], context: CommandContext) {
    if (!context.config.activeRepository) {
      console.log(chalk.yellow('No repository selected. Use /repo select first.'));
      return;
    }

    const [first, ...rest] = args;

    if (!first) {
      // Show interactive issue selector
      await selectIssueInteractive(context);
      return;
    }

    if (first === 'list') {
      await listIssuesCommand(rest, context);
      return;
    }

    // Try to parse as number
    const number = parseInt(first, 10);
    if (!isNaN(number)) {
      await selectIssue(number, context);
      return;
    }

    console.log(chalk.red(`Invalid argument: ${first}`));
    console.log('Usage: /issue [list|<number>] [--assignee <user>]');
  },
};

export const issuesCommand: Command = {
  name: 'issues',
  description: 'List issues in the active repository',
  args: [
    { name: 'options', description: '--assignee <user> | --flagged', required: false },
  ],
  async execute(args: string[], context: CommandContext) {
    if (!context.config.activeRepository) {
      console.log(chalk.yellow('No repository selected. Use /repo select first.'));
      return;
    }
    await listIssuesCommand(args, context);
  },
};

async function selectIssueInteractive(context: CommandContext): Promise<void> {
  const repo = context.config.activeRepository!;
  
  console.log(chalk.gray(`\nFetching issues from ${repo.owner}/${repo.repo}...\n`));

  try {
    const issues = await listIssues(repo);
    
    if (issues.length === 0) {
      console.log(chalk.yellow('No issues found.'));
      return;
    }

    // Check which issues have notes, flags, and pins
    const issuesWithNotes = new Set<number>();
    const flaggedIssues = new Set<number>();
    const pinnedIssues = new Set<number>();
    for (const issue of issues) {
      const note = await getNote(repo.owner, repo.repo, issue.number);
      if (note) issuesWithNotes.add(issue.number);
      if (isFlagged(context.config, repo.owner, repo.repo, issue.number)) {
        flaggedIssues.add(issue.number);
      }
      if (isPinned(context.config, repo.owner, repo.repo, issue.number)) {
        pinnedIssues.add(issue.number);
      }
    }

    // Sort issues with pinned at top
    const sortedIssues = [...issues].sort((a, b) => {
      const aPinned = pinnedIssues.has(a.number);
      const bPinned = pinnedIssues.has(b.number);
      if (aPinned && !bPinned) return -1;
      if (!aPinned && bPinned) return 1;
      return 0;
    });

    const ac = new AbortController();
    
    // Listen for escape key to cancel
    const escapeHandler = (data: Buffer) => {
      if (data[0] === 27 && data.length === 1) {
        ac.abort();
      }
    };
    process.stdin.on('data', escapeHandler);

    try {
      const selected = await search({
        message: 'Select an issue',
        source: async (input) => {
          const term = (input || '').toLowerCase();
          
          return sortedIssues
            .filter(issue => {
              if (!term) return true;
              return issue.title.toLowerCase().includes(term) ||
                     issue.number.toString().includes(term) ||
                     issue.labels.some(l => l.toLowerCase().includes(term));
            })
            .map(issue => ({
              name: formatIssueChoice(issue, context.config.activeIssue, issuesWithNotes.has(issue.number), flaggedIssues.has(issue.number), pinnedIssues.has(issue.number)),
              value: issue.number,
            }));
        },
        theme: {
          style: {
            keysHelpTip: () => chalk.gray('↑↓ navigate • ⏎ select • esc cancel'),
          },
        },
      }, { signal: ac.signal });

      if (selected) {
        await selectIssue(selected, context);
      }
    } finally {
      process.stdin.removeListener('data', escapeHandler);
    }
  } catch (error) {
    if (error instanceof Error && !error.message.includes('abort')) {
      console.log(chalk.red(`Error: ${error.message}`));
    }
  }
}

async function listIssuesCommand(args: string[], context: CommandContext): Promise<void> {
  const repo = context.config.activeRepository!;
  
  // Parse options
  let assignee: string | undefined;
  let flaggedOnly = false;
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--assignee' && args[i + 1]) {
      assignee = args[i + 1];
      if (assignee === 'me') {
        assignee = context.config.username || undefined;
        if (!assignee) {
          console.log(chalk.yellow('Username not configured. Use /config username <name> first.'));
          return;
        }
      }
      i++;
    } else if (args[i] === '--flagged' || args[i] === '-f') {
      flaggedOnly = true;
    }
  }

  // If flagged only, show flagged issues
  if (flaggedOnly) {
    const flaggedItems = getFlaggedItems(context.config, repo.owner, repo.repo, 'issue');
    
    if (flaggedItems.length === 0) {
      console.log(chalk.yellow('\nNo flagged issues found.'));
      console.log(chalk.gray('Use /flag to flag the active issue.\n'));
      return;
    }

    console.log(chalk.bold('\n⭐ Flagged issues:\n'));
    
    for (const flagged of flaggedItems) {
      const issue = await getIssue(repo, flagged.number);
      if (issue) {
        const note = await getNote(repo.owner, repo.repo, issue.number);
        const pinned = isPinned(context.config, repo.owner, repo.repo, issue.number);
        displayIssueLine(issue, context.config.activeIssue, !!note, true, pinned);
      }
    }
    console.log();
    return;
  }

  console.log(chalk.gray(`\nFetching issues from ${repo.owner}/${repo.repo}...\n`));

  try {
    const issues = await listIssues(repo, assignee);
    
    if (issues.length === 0) {
      console.log(chalk.yellow('No issues found.'));
      return;
    }

    // Check which issues have notes, flags, and pins
    const issuesWithNotes = new Set<number>();
    const flaggedIssues = new Set<number>();
    const pinnedIssues = new Set<number>();
    for (const issue of issues) {
      const note = await getNote(repo.owner, repo.repo, issue.number);
      if (note) issuesWithNotes.add(issue.number);
      if (isFlagged(context.config, repo.owner, repo.repo, issue.number)) {
        flaggedIssues.add(issue.number);
      }
      if (isPinned(context.config, repo.owner, repo.repo, issue.number)) {
        pinnedIssues.add(issue.number);
      }
    }

    // Sort issues with pinned at top
    const sortedIssues = [...issues].sort((a, b) => {
      const aPinned = pinnedIssues.has(a.number);
      const bPinned = pinnedIssues.has(b.number);
      if (aPinned && !bPinned) return -1;
      if (!aPinned && bPinned) return 1;
      return 0;
    });

    for (const issue of sortedIssues) {
      displayIssueLine(issue, context.config.activeIssue, issuesWithNotes.has(issue.number), flaggedIssues.has(issue.number), pinnedIssues.has(issue.number));
    }
    console.log();
  } catch (error) {
    if (error instanceof Error) {
      console.log(chalk.red(`Error: ${error.message}`));
    }
  }
}

async function selectIssue(number: number, context: CommandContext): Promise<void> {
  const repo = context.config.activeRepository!;
  
  console.log(chalk.gray(`\nFetching issue #${number}...\n`));

  const issue = await getIssue(repo, number);
  if (!issue) {
    console.log(chalk.red(`Issue #${number} not found`));
    return;
  }

  context.config.activeIssue = number;
  context.config.activePR = null;
  await context.saveConfig();

  displayIssue(issue);

  // Check if worktree exists and switch to it
  const switched = await checkAndSwitchWorktree(number, context);
  
  // If no worktree, show available commands
  if (!switched) {
    console.log(chalk.gray('Available commands:'));
    console.log(chalk.gray('  /fix      - Start working on this issue'));
    console.log(chalk.gray('  /explain  - Explain the issue'));
    console.log();
  }
}

function formatIssueChoice(issue: Issue, activeNumber: number | null, hasNotes: boolean = false, isFlagged: boolean = false, isPinned: boolean = false): string {
  const isActive = issue.number === activeNumber;
  const stateIcon = issue.state === 'OPEN' ? chalk.green('●') : chalk.red('●');
  const prefix = isActive ? chalk.cyan('▶ ') : '  ';
  const pinIcon = isPinned ? chalk.magenta('📌 ') : '';
  const flagIcon = isFlagged ? chalk.yellow('⭐ ') : '';
  const labels = issue.labels.length > 0 ? chalk.gray(` [${issue.labels.slice(0, 2).join(', ')}]`) : '';
  const noteIcon = hasNotes ? chalk.yellow(' 📝') : '';
  
  return prefix + pinIcon + flagIcon + stateIcon + ' ' + chalk.bold(`#${issue.number}`) + ' ' + issue.title + labels + noteIcon;
}

function displayIssueLine(issue: Issue, activeNumber: number | null, hasNotes: boolean = false, isFlagged: boolean = false, isPinned: boolean = false): void {
  const isActive = issue.number === activeNumber;
  const stateColor = issue.state === 'OPEN' ? chalk.green : chalk.red;
  const prefix = isActive ? chalk.cyan('● ') : '  ';
  const pinIcon = isPinned ? chalk.magenta('📌 ') : '';
  const flagIcon = isFlagged ? chalk.yellow('⭐ ') : '';
  const noteIcon = hasNotes ? chalk.yellow(' 📝') : '';
  
  const labels = issue.labels.length > 0 
    ? chalk.gray(` [${issue.labels.join(', ')}]`) 
    : '';
  
  console.log(
    prefix +
    pinIcon +
    flagIcon +
    chalk.bold(`#${issue.number}`) + ' ' +
    stateColor(`[${issue.state}]`) + ' ' +
    issue.title +
    labels +
    noteIcon
  );
}

function displayIssue(issue: Issue): void {
  console.log(chalk.bold.cyan(`#${issue.number}`) + ' ' + chalk.bold(issue.title));
  console.log();
  console.log(chalk.gray('  State:   '), issue.state === 'OPEN' ? chalk.green('OPEN') : chalk.red('CLOSED'));
  console.log(chalk.gray('  Author:  '), issue.author);
  if (issue.assignees.length > 0) {
    console.log(chalk.gray('  Assigned:'), issue.assignees.join(', '));
  }
  if (issue.labels.length > 0) {
    console.log(chalk.gray('  Labels:  '), issue.labels.join(', '));
  }
  console.log(chalk.gray('  URL:     '), chalk.blue.underline(issue.url));
  console.log();
}
