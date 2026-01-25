import chalk from 'chalk';
import { search } from '@inquirer/prompts';
import type { Command, CommandContext, Issue } from '../types/index.js';
import { listIssues, getIssue } from '../utils/github.js';
import { checkAndSwitchWorktree } from './worktrees.js';

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
    { name: 'options', description: '--assignee <user>', required: false },
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
          
          return issues
            .filter(issue => {
              if (!term) return true;
              return issue.title.toLowerCase().includes(term) ||
                     issue.number.toString().includes(term) ||
                     issue.labels.some(l => l.toLowerCase().includes(term));
            })
            .map(issue => ({
              name: formatIssueChoice(issue, context.config.activeIssue),
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
    }
  }

  console.log(chalk.gray(`\nFetching issues from ${repo.owner}/${repo.repo}...\n`));

  try {
    const issues = await listIssues(repo, assignee);
    
    if (issues.length === 0) {
      console.log(chalk.yellow('No issues found.'));
      return;
    }

    for (const issue of issues) {
      displayIssueLine(issue, context.config.activeIssue);
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

function formatIssueChoice(issue: Issue, activeNumber: number | null): string {
  const isActive = issue.number === activeNumber;
  const stateIcon = issue.state === 'OPEN' ? chalk.green('●') : chalk.red('●');
  const prefix = isActive ? chalk.cyan('▶ ') : '  ';
  const labels = issue.labels.length > 0 ? chalk.gray(` [${issue.labels.slice(0, 2).join(', ')}]`) : '';
  
  return prefix + stateIcon + ' ' + chalk.bold(`#${issue.number}`) + ' ' + issue.title + labels;
}

function displayIssueLine(issue: Issue, activeNumber: number | null): void {
  const isActive = issue.number === activeNumber;
  const stateColor = issue.state === 'OPEN' ? chalk.green : chalk.red;
  const prefix = isActive ? chalk.cyan('● ') : '  ';
  
  const labels = issue.labels.length > 0 
    ? chalk.gray(` [${issue.labels.join(', ')}]`) 
    : '';
  
  console.log(
    prefix +
    chalk.bold(`#${issue.number}`) + ' ' +
    stateColor(`[${issue.state}]`) + ' ' +
    issue.title +
    labels
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
