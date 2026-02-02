import chalk from 'chalk';
import type { Command, CommandContext } from '../types/index.js';
import { togglePin, isPinned } from '../utils/config.js';

export const pinCommand: Command = {
  name: 'pin',
  description: 'Pin the active issue/PR to appear at top of lists',
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

    const result = togglePin(context.config, repo.owner, repo.repo, number, type);
    await context.saveConfig();

    if (result.pinned) {
      console.log(chalk.green(`📌 Pinned #${number} to top of lists`));
    } else {
      console.log(chalk.gray(`Unpinned #${number}`));
    }
  },
};

export const unpinCommand: Command = {
  name: 'unpin',
  description: 'Unpin the active issue/PR',
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

    if (!isPinned(context.config, repo.owner, repo.repo, number)) {
      console.log(chalk.gray(`#${number} is not pinned.`));
      return;
    }

    // Use togglePin to unpin (since it's currently pinned)
    togglePin(context.config, repo.owner, repo.repo, number, 'issue');
    await context.saveConfig();
    console.log(chalk.gray(`Unpinned #${number}`));
  },
};
