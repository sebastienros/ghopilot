import chalk from 'chalk';
import type { Command, CommandContext } from '../types/index.js';
import {
  getAllDefaultPrompts,
  getPrompt,
  getDefaultPrompt,
  saveUserPrompt,
  deleteUserPrompt,
  isPromptCustomized,
  resetAllPrompts,
  getPromptsDir,
} from '../utils/prompts.js';
import { confirm } from '@inquirer/prompts';

export const promptCommand: Command = {
  name: 'prompt',
  description: 'Manage prompt templates',
  args: [
    { name: 'list|show|customize|reset', description: 'Subcommand', required: false },
    { name: 'name', description: 'Prompt name', required: false },
  ],
  async execute(args: string[], context: CommandContext) {
    const [subcommand, name] = args;

    if (!subcommand || subcommand === 'list') {
      await listPrompts();
      return;
    }

    switch (subcommand) {
      case 'show':
        if (name) {
          await showPrompt(name);
        } else {
          console.log(chalk.red('Usage: /prompt show <name>'));
        }
        break;
      case 'customize':
        if (name) {
          await customizePrompt(name);
        } else {
          console.log(chalk.red('Usage: /prompt customize <name>'));
        }
        break;
      case 'reset':
        if (name === '--all') {
          await resetAll();
        } else if (name) {
          await resetPrompt(name);
        } else {
          console.log(chalk.red('Usage: /prompt reset <name> or /prompt reset --all'));
        }
        break;
      default:
        // Maybe it's a prompt name - show it
        const prompt = await getPrompt(subcommand);
        if (prompt) {
          await showPrompt(subcommand);
        } else {
          console.log(chalk.red(`Unknown subcommand: ${subcommand}`));
          console.log('Usage: /prompt [list|show|customize|reset] [name]');
        }
    }
  },
};

export const promptsCommand: Command = {
  name: 'prompts',
  description: 'List all prompt templates',
  async execute(_args: string[], _context: CommandContext) {
    await listPrompts();
  },
};

async function listPrompts(): Promise<void> {
  const prompts = getAllDefaultPrompts();

  console.log(chalk.bold('\nPrompt Templates:\n'));
  console.log(chalk.gray(`  Customizations stored in: ${getPromptsDir()}\n`));

  for (const prompt of prompts) {
    const customized = await isPromptCustomized(prompt.name);
    const status = customized ? chalk.cyan(' (customized)') : '';
    console.log(chalk.bold(`  ${prompt.name}`) + status);
    console.log(chalk.gray(`    ${prompt.description}`));
  }

  console.log();
  console.log(chalk.gray('  Commands:'));
  console.log(chalk.gray('    /prompt show <name>      - View prompt template'));
  console.log(chalk.gray('    /prompt customize <name> - Export to user folder for editing'));
  console.log(chalk.gray('    /prompt reset <name>     - Revert to default'));
  console.log(chalk.gray('    /prompt reset --all      - Revert all prompts'));
  console.log();
}

async function showPrompt(name: string): Promise<void> {
  const prompt = await getPrompt(name);
  
  if (!prompt) {
    console.log(chalk.red(`Unknown prompt: ${name}`));
    console.log(chalk.gray('Use /prompts to see available prompts.'));
    return;
  }

  const customized = await isPromptCustomized(name);

  console.log();
  console.log(chalk.bold.cyan(prompt.name) + (customized ? chalk.yellow(' (customized)') : chalk.gray(' (default)')));
  console.log(chalk.gray(prompt.description));
  console.log();
  console.log(chalk.gray('─'.repeat(60)));
  console.log(prompt.content);
  console.log(chalk.gray('─'.repeat(60)));
  console.log();

  // Show available variables
  console.log(chalk.gray('Available variables:'));
  console.log(chalk.gray('  {{issue_number}}, {{issue_title}}, {{issue_body}}'));
  console.log(chalk.gray('  {{pr_number}}, {{pr_title}}, {{pr_body}}'));
  console.log(chalk.gray('  {{repo}}, {{branch}}, {{username}}, {{prefix}}'));
  console.log(chalk.gray('  {{#if variable}}...{{/if}} for conditionals'));
  console.log();
}

async function customizePrompt(name: string): Promise<void> {
  const defaultPrompt = getDefaultPrompt(name);
  
  if (!defaultPrompt) {
    console.log(chalk.red(`Unknown prompt: ${name}`));
    console.log(chalk.gray('Use /prompts to see available prompts.'));
    return;
  }

  const isAlreadyCustomized = await isPromptCustomized(name);
  if (isAlreadyCustomized) {
    const overwrite = await confirm({
      message: `Prompt '${name}' is already customized. Overwrite with default?`,
      default: false,
    });
    if (!overwrite) {
      console.log(chalk.gray('Cancelled.'));
      return;
    }
  }

  await saveUserPrompt(name, defaultPrompt.content);
  
  const filePath = `${getPromptsDir()}/${name}.md`;
  console.log(chalk.green(`\nPrompt exported to: ${filePath}`));
  console.log(chalk.gray('Edit this file to customize the prompt.'));
  console.log(chalk.gray('Use /prompt reset ' + name + ' to revert to default.'));
  console.log();
}

async function resetPrompt(name: string): Promise<void> {
  const defaultPrompt = getDefaultPrompt(name);
  
  if (!defaultPrompt) {
    console.log(chalk.red(`Unknown prompt: ${name}`));
    return;
  }

  const isCustomized = await isPromptCustomized(name);
  if (!isCustomized) {
    console.log(chalk.yellow(`Prompt '${name}' is not customized.`));
    return;
  }

  const shouldReset = await confirm({
    message: `Reset prompt '${name}' to default?`,
    default: false,
  });

  if (!shouldReset) {
    console.log(chalk.gray('Cancelled.'));
    return;
  }

  await deleteUserPrompt(name);
  console.log(chalk.green(`Prompt '${name}' reset to default.`));
}

async function resetAll(): Promise<void> {
  const shouldReset = await confirm({
    message: 'Reset ALL prompts to defaults? This cannot be undone.',
    default: false,
  });

  if (!shouldReset) {
    console.log(chalk.gray('Cancelled.'));
    return;
  }

  const count = await resetAllPrompts();
  if (count > 0) {
    console.log(chalk.green(`Reset ${count} customized prompt(s) to defaults.`));
  } else {
    console.log(chalk.yellow('No customized prompts to reset.'));
  }
}
