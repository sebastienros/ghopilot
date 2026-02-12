import { bold, cyan, gray, green, yellow, red, magenta } from '../utils/colors.ts';
import { homedir } from 'os';
import { join } from 'path';
import type { Command, CommandContext } from '../types/index.ts';
import { getReposPath } from '../utils/config.ts';
import { lineInput } from '../utils/ui.ts';

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
        console.log(red(`Unknown config key: ${key}`));
        console.log('Available keys: username, prefix, repospath');
        console.log(gray('Use /prompts to manage prompt templates.'));
    }
  },
};

function showConfig(context: CommandContext): void {
  console.log(bold('\nConfiguration:\n'));
  
  console.log(gray('  username: '), context.config.username || yellow('(not set)'));
  console.log(gray('  prefix:   '), context.config.branchPrefix || yellow('(not set)'));
  console.log(gray('  repospath:'), getReposPath(context.config));
  console.log(gray('  model:    '), context.config.defaultModel || yellow('(system default)'));
  console.log();
  console.log(gray('  Use /prompts to view and customize prompt templates.'));
  console.log(gray('  Use /models to list available models.'));
  console.log();
}

async function setUsername(value: string | undefined, context: CommandContext): Promise<void> {
  let username = value;
  
  if (!username) {
    username = await lineInput({
      message: 'Enter your GitHub username:',
      defaultValue: context.config.username || undefined,
    });
  }

  context.config.username = username || null;
  await context.saveConfig();
  console.log(green(`Username set to: ${username}`));
}

async function setBranchPrefix(value: string | undefined, context: CommandContext): Promise<void> {
  let prefix = value;
  
  if (!prefix) {
    prefix = await lineInput({
      message: 'Enter branch prefix:',
      defaultValue: context.config.branchPrefix || context.config.username || undefined,
    });
  }

  context.config.branchPrefix = prefix || null;
  await context.saveConfig();
  console.log(green(`Branch prefix set to: ${prefix}`));
}

async function setReposPath(value: string | undefined, context: CommandContext): Promise<void> {
  let reposPath = value;
  
  if (!reposPath) {
    const defaultPath = context.config.reposPath || join(homedir(), 'repos');
    reposPath = await lineInput({
      message: 'Enter path for cloning repositories:',
      defaultValue: defaultPath,
    });
  }

  context.config.reposPath = reposPath || null;
  await context.saveConfig();
  console.log(green(`Repositories path set to: ${reposPath}`));
}





