import chalk from 'chalk';
import { search } from '@inquirer/prompts';
import type { Command, CommandContext, PullRequest } from '../types/index.js';
import { listPullRequests, getPullRequest } from '../utils/github.js';
import { checkAndSwitchWorktree } from './worktrees.js';

export const prCommand: Command = {
  name: 'pr',
  description: 'View or select a pull request',
  args: [
    { name: 'number|list', description: 'PR number or list', required: false },
    { name: '--author|--reviewer user', description: 'Filter by user', required: false },
  ],
  async execute(args: string[], context: CommandContext) {
    if (!context.config.activeRepository) {
      console.log(chalk.yellow('No repository selected. Use /repo select first.'));
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

    console.log(chalk.red(`Invalid argument: ${first}`));
    console.log('Usage: /pr [list|<number>] [--author|--reviewer <user>]');
  },
};

export const prsCommand: Command = {
  name: 'prs',
  aliases: ['pulls'],
  description: 'List pull requests in the active repository',
  args: [
    { name: 'options', description: '--author|--reviewer <user>', required: false },
  ],
  async execute(args: string[], context: CommandContext) {
    if (!context.config.activeRepository) {
      console.log(chalk.yellow('No repository selected. Use /repo select first.'));
      return;
    }
    await listPRsCommand(args, context);
  },
};

async function selectPRInteractive(context: CommandContext): Promise<void> {
  const repo = context.config.activeRepository!;
  
  console.log(chalk.gray(`\nFetching PRs from ${repo.owner}/${repo.repo}...\n`));

  try {
    const prs = await listPullRequests(repo);
    
    if (prs.length === 0) {
      console.log(chalk.yellow('No pull requests found.'));
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
        message: 'Select a pull request',
        source: async (input) => {
          const term = (input || '').toLowerCase();
          
          return prs
            .filter(pr => {
              if (!term) return true;
              return pr.title.toLowerCase().includes(term) ||
                     pr.number.toString().includes(term) ||
                     pr.author.toLowerCase().includes(term) ||
                     pr.labels.some(l => l.toLowerCase().includes(term));
            })
            .map(pr => ({
              name: formatPRChoice(pr, context.config.activePR),
              value: pr.number,
            }));
        },
        theme: {
          style: {
            keysHelpTip: () => chalk.gray('↑↓ navigate • ⏎ select • esc cancel'),
          },
        },
      }, { signal: ac.signal });

      if (selected) {
        await selectPR(selected, context);
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

async function listPRsCommand(args: string[], context: CommandContext): Promise<void> {
  const repo = context.config.activeRepository!;
  
  // Parse options
  let author: string | undefined;
  let reviewer: string | undefined;
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--author' && args[i + 1]) {
      author = args[i + 1];
      if (author === 'me') {
        author = context.config.username || undefined;
        if (!author) {
          console.log(chalk.yellow('Username not configured. Use /config username <name> first.'));
          return;
        }
      }
      i++;
    } else if (args[i] === '--reviewer' && args[i + 1]) {
      reviewer = args[i + 1];
      if (reviewer === 'me') {
        reviewer = context.config.username || undefined;
        if (!reviewer) {
          console.log(chalk.yellow('Username not configured. Use /config username <name> first.'));
          return;
        }
      }
      i++;
    }
  }

  console.log(chalk.gray(`\nFetching PRs from ${repo.owner}/${repo.repo}...\n`));

  try {
    const prs = await listPullRequests(repo, { author, reviewer });
    
    if (prs.length === 0) {
      console.log(chalk.yellow('No pull requests found.'));
      return;
    }

    for (const pr of prs) {
      displayPRLine(pr, context.config.activePR);
    }
    console.log();
  } catch (error) {
    if (error instanceof Error) {
      console.log(chalk.red(`Error: ${error.message}`));
    }
  }
}

async function selectPR(number: number, context: CommandContext): Promise<void> {
  const repo = context.config.activeRepository!;
  
  console.log(chalk.gray(`\nFetching PR #${number}...\n`));

  const pr = await getPullRequest(repo, number);
  if (!pr) {
    console.log(chalk.red(`PR #${number} not found`));
    return;
  }

  context.config.activePR = number;
  context.config.activeIssue = null;
  await context.saveConfig();

  displayPR(pr);

  // Check if worktree exists and switch to it
  await checkAndSwitchWorktree(number, context);
}

function formatPRChoice(pr: PullRequest, activeNumber: number | null): string {
  const isActive = pr.number === activeNumber;
  const stateIcon = pr.state === 'OPEN' ? chalk.green('●') : pr.state === 'MERGED' ? chalk.magenta('●') : chalk.red('●');
  const prefix = isActive ? chalk.cyan('▶ ') : '  ';
  const draft = pr.isDraft ? chalk.gray(' [DRAFT]') : '';
  const labels = pr.labels.length > 0 ? chalk.gray(` [${pr.labels.slice(0, 2).join(', ')}]`) : '';
  
  return prefix + stateIcon + ' ' + chalk.bold(`#${pr.number}`) + ' ' + pr.title + draft + labels;
}

function displayPRLine(pr: PullRequest, activeNumber: number | null): void {
  const isActive = pr.number === activeNumber;
  const stateColor = pr.state === 'OPEN' ? chalk.green : pr.state === 'MERGED' ? chalk.magenta : chalk.red;
  const prefix = isActive ? chalk.cyan('● ') : '  ';
  const draft = pr.isDraft ? chalk.gray(' [DRAFT]') : '';
  
  const labels = pr.labels.length > 0 
    ? chalk.gray(` [${pr.labels.join(', ')}]`) 
    : '';
  
  console.log(
    prefix +
    chalk.bold(`#${pr.number}`) + ' ' +
    stateColor(`[${pr.state}]`) + 
    draft + ' ' +
    pr.title +
    labels
  );
}

function displayPR(pr: PullRequest): void {
  console.log(chalk.bold.cyan(`#${pr.number}`) + ' ' + chalk.bold(pr.title));
  console.log();
  
  const stateColor = pr.state === 'OPEN' ? chalk.green : pr.state === 'MERGED' ? chalk.magenta : chalk.red;
  console.log(chalk.gray('  State:   '), stateColor(pr.state) + (pr.isDraft ? chalk.gray(' (DRAFT)') : ''));
  console.log(chalk.gray('  Author:  '), pr.author);
  console.log(chalk.gray('  Branch:  '), chalk.cyan(pr.headBranch), chalk.gray('→'), chalk.cyan(pr.baseBranch));
  
  if (pr.reviewers.length > 0) {
    console.log(chalk.gray('  Reviewers:'), pr.reviewers.join(', '));
  }
  if (pr.labels.length > 0) {
    console.log(chalk.gray('  Labels:  '), pr.labels.join(', '));
  }
  console.log(chalk.gray('  URL:     '), chalk.blue.underline(pr.url));
  console.log();
}
