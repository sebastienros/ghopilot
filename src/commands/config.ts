import chalk from 'chalk';
import * as os from 'os';
import * as path from 'path';
import type { Command, CommandContext } from '../types/index.js';
import { input } from '@inquirer/prompts';
import { getReposPath } from '../utils/config.js';

export const configCommand: Command = {
  name: 'config',
  description: 'View or update configuration',
  args: [
    { name: 'username|prefix|repospath', description: 'Config key', required: false },
    { name: 'value', description: 'Value to set', required: false },
  ],
  async execute(args: string[], context: CommandContext) {
    const [key, ...valueParts] = args;
    const value = valueParts.join(' ');

    if (!key) {
      // Show current configuration
      showConfig(context);
      return;
    }

    switch (key) {
      case 'username':
        await setUsername(value, context);
        break;
      case 'prefix':
        await setBranchPrefix(value, context);
        break;
      case 'repospath':
      case 'repos-path':
      case 'path':
        await setReposPath(value, context);
        break;
      default:
        console.log(chalk.red(`Unknown config key: ${key}`));
        console.log('Available keys: username, prefix, repospath');
        console.log(chalk.gray('Use /prompts to manage prompt templates.'));
    }
  },
};

function showConfig(context: CommandContext): void {
  console.log(chalk.bold('\nConfiguration:\n'));
  
  console.log(chalk.gray('  username: '), context.config.username || chalk.yellow('(not set)'));
  console.log(chalk.gray('  prefix:   '), context.config.branchPrefix || chalk.yellow('(not set)'));
  console.log(chalk.gray('  repospath:'), getReposPath(context.config));
  console.log();
  console.log(chalk.gray('  Use /prompts to view and customize prompt templates.'));
  console.log();
}

async function setUsername(value: string | undefined, context: CommandContext): Promise<void> {
  let username = value;
  
  if (!username) {
    username = await input({
      message: 'Enter your GitHub username:',
      default: context.config.username || undefined,
    });
  }

  context.config.username = username || null;
  await context.saveConfig();
  console.log(chalk.green(`Username set to: ${username}`));
}

async function setBranchPrefix(value: string | undefined, context: CommandContext): Promise<void> {
  let prefix = value;
  
  if (!prefix) {
    prefix = await input({
      message: 'Enter branch prefix:',
      default: context.config.branchPrefix || context.config.username || undefined,
    });
  }

  context.config.branchPrefix = prefix || null;
  await context.saveConfig();
  console.log(chalk.green(`Branch prefix set to: ${prefix}`));
}

async function setReposPath(value: string | undefined, context: CommandContext): Promise<void> {
  let reposPath = value;
  
  if (!reposPath) {
    const defaultPath = context.config.reposPath || path.join(os.homedir(), 'repos');
    reposPath = await input({
      message: 'Enter path for cloning repositories:',
      default: defaultPath,
    });
  }

  context.config.reposPath = reposPath || null;
  await context.saveConfig();
  console.log(chalk.green(`Repositories path set to: ${reposPath}`));
}
