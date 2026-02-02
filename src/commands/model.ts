import chalk from 'chalk';
import { select } from '@inquirer/prompts';
import type { Command, CommandContext } from '../types/index.js';
import { listModels } from '../utils/copilot.js';

export const modelsCommand: Command = {
  name: 'models',
  description: 'List available AI models',
  async execute(_args: string[], context: CommandContext) {
    console.log(chalk.cyan('\nFetching available models...\n'));
    
    try {
      const models = await listModels();
      
      if (models.length === 0) {
        console.log(chalk.yellow('No models available.'));
        return;
      }
      
      const current = context.config.defaultModel;
      
      console.log(chalk.bold('Available models:\n'));
      for (const model of models) {
        if (model === current) {
          console.log(`  ${chalk.green('●')} ${chalk.green(model)} ${chalk.gray('(default)')}`);
        } else {
          console.log(`  ${chalk.gray('○')} ${model}`);
        }
      }
      console.log();
      
      if (!current) {
        console.log(chalk.gray('No default model configured (using system default).'));
      }
      console.log(chalk.gray('Use /model to select a default model.'));
      console.log();
    } catch (error) {
      if (error instanceof Error) {
        console.log(chalk.red(`Error fetching models: ${error.message}`));
      }
    }
  },
};

export const modelCommand: Command = {
  name: 'model',
  description: 'View or set the default AI model',
  args: [
    { name: 'name', description: 'Model name to set', required: false },
  ],
  async execute(args: string[], context: CommandContext) {
    const [modelName] = args;
    
    if (!modelName) {
      // Show interactive model selector
      await selectModelInteractive(context);
      return;
    }
    
    // Validate model exists and set it
    try {
      const models = await listModels();
      
      if (!models.includes(modelName)) {
        console.log(chalk.red(`\nModel "${modelName}" not found.`));
        console.log(chalk.gray('Use /models to list available models.'));
        console.log();
        return;
      }
      
      // Set the model
      context.config.defaultModel = modelName;
      await context.saveConfig();
      console.log(chalk.green(`\n✓ Default model set to: ${modelName}`));
      console.log();
    } catch (error) {
      if (error instanceof Error) {
        console.log(chalk.red(`Error: ${error.message}`));
      }
    }
  },
};

async function selectModelInteractive(context: CommandContext): Promise<void> {
  console.log(chalk.gray('\nFetching available models...\n'));

  try {
    const models = await listModels();
    
    if (models.length === 0) {
      console.log(chalk.yellow('No models available.'));
      return;
    }

    const current = context.config.defaultModel;
    
    const choices = models.map(model => ({
      name: model === current 
        ? `${model} ${chalk.gray('(current)')}`
        : model,
      value: model,
    }));

    const selected = await select({
      message: 'Select default model',
      choices,
      default: current || undefined,
    });

    if (selected) {
      context.config.defaultModel = selected;
      await context.saveConfig();
      console.log(chalk.green(`\n✓ Default model set to: ${selected}`));
    }
    console.log();
  } catch (error) {
    if (error instanceof Error && !error.message.includes('abort')) {
      console.log(chalk.red(`Error: ${error.message}`));
    }
  }
}
