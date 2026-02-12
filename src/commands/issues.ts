import { bold, cyan, gray, green, yellow, red, magenta } from '../utils/colors.ts';
import type { Command, CommandContext, Issue } from '../types/index.ts';
import { listIssues, getIssue } from '../utils/github.ts';
import { checkAndSwitchWorktree } from './worktrees.ts';
import { getNote, isFlagged, toggleFlag, getFlaggedItems, isPinned } from '../utils/config.ts';
import { selectPrompt } from '../utils/ui.ts';

export const issueCommand: Command = {
  name: 'issue',
  description: 'View or select an issue',
  args: [
    { name: 'number|list', description: 'Issue number or list', required: false },
    { name: '--assignee user', description: 'Filter by assignee', required: false },
  ],
  async execute(args: string[], context: CommandContext) {
    if (!context.config.activeRepository) {
      console.log(yellow('No repository selected. Use /repo select first.'));
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

    console.log(red(`Invalid argument: ${first}`));
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
      console.log(yellow('No repository selected. Use /repo select first.'));
      return;
    }
    await listIssuesCommand(args, context);
  },
};

async function selectIssueInteractive(context: CommandContext): Promise<void> {
  const repo = context.config.activeRepository!;
  
  console.log(gray(`\nFetching issues from ${repo.owner}/${repo.repo}...\n`));

  try {
    const issues = await listIssues(repo);
    
    if (issues.length === 0) {
      console.log(yellow('No issues found.'));
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

    const choices = sortedIssues.map(issue => ({
      name: formatIssueChoice(issue, context.config.activeIssue, issuesWithNotes.has(issue.number), flaggedIssues.has(issue.number), pinnedIssues.has(issue.number)),
      value: issue.number,
    }));

    try {
      const selected = await selectPrompt({
        message: 'Select an issue',
        choices,
      });

      if (selected) {
        await selectIssue(selected, context);
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
          console.log(yellow('Username not configured. Use /config username <name> first.'));
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
      console.log(yellow('\nNo flagged issues found.'));
      console.log(gray('Use /flag to flag the active issue.\n'));
      return;
    }

    console.log(bold('\n⭐ Flagged issues:\n'));
    
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

  console.log(gray(`\nFetching issues from ${repo.owner}/${repo.repo}...\n`));

  try {
    const issues = await listIssues(repo, assignee);
    
    if (issues.length === 0) {
      console.log(yellow('No issues found.'));
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
      console.log(red(`Error: ${error.message}`));
    }
  }
}

async function selectIssue(number: number, context: CommandContext): Promise<void> {
  const repo = context.config.activeRepository!;
  
  console.log(gray(`\nFetching issue #${number}...\n`));

  const issue = await getIssue(repo, number);
  if (!issue) {
    console.log(red(`Issue #${number} not found`));
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
    console.log(gray('Available commands:'));
    console.log(gray('  /fix      - Start working on this issue'));
    console.log(gray('  /explain  - Explain the issue'));
    console.log();
  }
}

function formatIssueChoice(issue: Issue, activeNumber: number | null, hasNotes: boolean = false, isFlagged: boolean = false, isPinned: boolean = false): string {
  const isActive = issue.number === activeNumber;
  const stateIcon = issue.state === 'OPEN' ? green('●') : red('●');
  const prefix = isActive ? cyan('▶ ') : '  ';
  const pinIcon = isPinned ? magenta('📌 ') : '';
  const flagIcon = isFlagged ? yellow('⭐ ') : '';
  const labels = issue.labels.length > 0 ? gray(` [${issue.labels.slice(0, 2).join(', ')}]`) : '';
  const noteIcon = hasNotes ? yellow(' 📝') : '';
  
  return prefix + pinIcon + flagIcon + stateIcon + ' ' + bold(`#${issue.number}`) + ' ' + issue.title + labels + noteIcon;
}

function displayIssueLine(issue: Issue, activeNumber: number | null, hasNotes: boolean = false, isFlagged: boolean = false, isPinned: boolean = false): void {
  const isActive = issue.number === activeNumber;
  const stateColor = issue.state === 'OPEN' ? green : red;
  const prefix = isActive ? cyan('● ') : '  ';
  const pinIcon = isPinned ? magenta('📌 ') : '';
  const flagIcon = isFlagged ? yellow('⭐ ') : '';
  const noteIcon = hasNotes ? yellow(' 📝') : '';
  
  const labels = issue.labels.length > 0 
    ? gray(` [${issue.labels.join(', ')}]`) 
    : '';
  
  console.log(
    prefix +
    pinIcon +
    flagIcon +
    bold(`#${issue.number}`) + ' ' +
    stateColor(`[${issue.state}]`) + ' ' +
    issue.title +
    labels +
    noteIcon
  );
}

function displayIssue(issue: Issue): void {
  console.log(bold(cyan(`#${issue.number}`)) + ' ' + bold(issue.title));
  console.log();
  console.log(gray('  State:   '), issue.state === 'OPEN' ? green('OPEN') : red('CLOSED'));
  console.log(gray('  Author:  '), issue.author);
  if (issue.assignees.length > 0) {
    console.log(gray('  Assigned:'), issue.assignees.join(', '));
  }
  if (issue.labels.length > 0) {
    console.log(gray('  Labels:  '), issue.labels.join(', '));
  }
  console.log(gray('  URL:     '), cyan(issue.url));
  console.log();
}





