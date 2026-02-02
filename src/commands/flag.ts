import chalk from 'chalk';
import type { Command, CommandContext } from '../types/index.js';
import { toggleFlag, getFlaggedItems, isFlagged } from '../utils/config.js';
import { getIssue, getPullRequest } from '../utils/github.js';

export const flagCommand: Command = {
  name: 'flag',
  aliases: ['fav', 'star'],
  description: 'Toggle flag on the active issue/PR',
  args: [
    { name: 'number', description: 'Issue/PR number (or use active)', required: false },
  ],
  async execute(args: string[], context: CommandContext) {
    if (!context.config.activeRepository) {
      console.log(chalk.yellow('No repository selected. Use /repo select first.'));
      return;
    }

    const repo = context.config.activeRepository;
    let number: number | undefined;
    let type: 'issue' | 'pr';

    // Parse number from args if provided
    if (args[0]) {
      number = parseInt(args[0], 10);
      if (isNaN(number)) {
        console.log(chalk.red('Invalid number'));
        return;
      }
      // Try to determine type
      type = context.config.activePR === number ? 'pr' : 'issue';
    } else {
      // Use active issue/PR
      if (context.config.activePR) {
        number = context.config.activePR;
        type = 'pr';
      } else if (context.config.activeIssue) {
        number = context.config.activeIssue;
        type = 'issue';
      } else {
        console.log(chalk.yellow('No issue or PR selected. Use /issue or /pr to select one.'));
        return;
      }
    }

    const result = toggleFlag(context.config, repo.owner, repo.repo, number, type);
    await context.saveConfig();

    if (result.flagged) {
      console.log(chalk.green(`⭐ Flagged #${number}`));
    } else {
      console.log(chalk.gray(`Unflagged #${number}`));
    }
  },
};

export const flaggedCommand: Command = {
  name: 'flagged',
  aliases: ['starred', 'focus'],
  description: 'List all flagged issues and PRs',
  async execute(_args: string[], context: CommandContext) {
    if (!context.config.activeRepository) {
      console.log(chalk.yellow('No repository selected. Use /repo select first.'));
      return;
    }

    const repo = context.config.activeRepository;
    const flaggedItems = getFlaggedItems(context.config, repo.owner, repo.repo);

    if (flaggedItems.length === 0) {
      console.log(chalk.yellow('\nNo flagged items found.'));
      console.log(chalk.gray('Use /flag to flag the active issue/PR.\n'));
      return;
    }

    console.log(chalk.bold('\n⭐ Flagged items:\n'));

    for (const flagged of flaggedItems) {
      if (flagged.type === 'issue') {
        const issue = await getIssue(repo, flagged.number);
        if (issue) {
          const isActive = context.config.activeIssue === flagged.number;
          const prefix = isActive ? chalk.cyan('● ') : '  ';
          const stateColor = issue.state === 'OPEN' ? chalk.green : chalk.red;
          console.log(
            prefix +
            chalk.yellow('⭐ ') +
            chalk.green('Issue ') +
            chalk.bold(`#${issue.number}`) + ' ' +
            stateColor(`[${issue.state}]`) + ' ' +
            issue.title
          );
        }
      } else {
        const pr = await getPullRequest(repo, flagged.number);
        if (pr) {
          const isActive = context.config.activePR === flagged.number;
          const prefix = isActive ? chalk.cyan('● ') : '  ';
          const stateColor = pr.state === 'OPEN' ? chalk.green : pr.state === 'MERGED' ? chalk.magenta : chalk.red;
          console.log(
            prefix +
            chalk.yellow('⭐ ') +
            chalk.magenta('PR ') +
            chalk.bold(`#${pr.number}`) + ' ' +
            stateColor(`[${pr.state}]`) + ' ' +
            pr.title
          );
        }
      }
    }
    console.log();
  },
};

export const unflagCommand: Command = {
  name: 'unflag',
  description: 'Remove flag from the active issue/PR',
  args: [
    { name: 'number', description: 'Issue/PR number (or use active)', required: false },
  ],
  async execute(args: string[], context: CommandContext) {
    if (!context.config.activeRepository) {
      console.log(chalk.yellow('No repository selected. Use /repo select first.'));
      return;
    }

    const repo = context.config.activeRepository;
    let number: number | undefined;

    // Parse number from args if provided
    if (args[0]) {
      number = parseInt(args[0], 10);
      if (isNaN(number)) {
        console.log(chalk.red('Invalid number'));
        return;
      }
    } else {
      // Use active issue/PR
      if (context.config.activePR) {
        number = context.config.activePR;
      } else if (context.config.activeIssue) {
        number = context.config.activeIssue;
      } else {
        console.log(chalk.yellow('No issue or PR selected. Use /issue or /pr to select one.'));
        return;
      }
    }

    if (!isFlagged(context.config, repo.owner, repo.repo, number)) {
      console.log(chalk.gray(`#${number} is not flagged.`));
      return;
    }

    // Use toggleFlag to unflag (since it's currently flagged)
    toggleFlag(context.config, repo.owner, repo.repo, number, 'issue');
    await context.saveConfig();
    console.log(chalk.gray(`Unflagged #${number}`));
  },
};
