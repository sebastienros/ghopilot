import { bold, cyan, gray, green, yellow, red, magenta } from '../utils/colors.ts';
import type { Command, CommandContext } from '../types/index.ts';
import { listModels } from '../utils/copilot.ts';
import { selectPrompt } from '../utils/ui.ts';

export const modelsCommand: Command = {
  name: 'models',
  description: 'List available AI models',
  async execute(_args: string[], context: CommandContext) {
    console.log(cyan('\nFetching available models...\n'));
    
    try {
      const models = await listModels();
      
      if (models.length === 0) {
        console.log(yellow('No models available.'));
        return;
      }
      
      const current = context.config.defaultModel;
      
      console.log(bold('Available models:\n'));
      for (const model of models) {
        if (model === current) {
          console.log(`  ${green('●')} ${green(model)} ${gray('(default)')}`);
        } else {
          console.log(`  ${gray('○')} ${model}`);
        }
      }
      console.log();
      
      if (!current) {
        console.log(gray('No default model configured (using system default).'));
      }
      console.log(gray('Use /model to select a default model.'));
      console.log();
    } catch (error) {
      if (error instanceof Error) {
        console.log(red(`Error fetching models: ${error.message}`));
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
        console.log(red(`\nModel "${modelName}" not found.`));
        console.log(gray('Use /models to list available models.'));
        console.log();
        return;
      }
      
      // Set the model
      context.config.defaultModel = modelName;
      await context.saveConfig();
      console.log(green(`\n✓ Default model set to: ${modelName}`));
      console.log();
    } catch (error) {
      if (error instanceof Error) {
        console.log(red(`Error: ${error.message}`));
      }
    }
  },
};

async function selectModelInteractive(context: CommandContext): Promise<void> {
  console.log(gray('\nFetching available models...\n'));

  try {
    const models = await listModels();
    
    if (models.length === 0) {
      console.log(yellow('No models available.'));
      return;
    }

    const current = context.config.defaultModel;
    
    const choices = models.map(model => ({
      name: model === current 
        ? `${model} ${gray('(current)')}`
        : model,
      value: model,
    }));

    const selected = await selectPrompt({
      message: 'Select default model',
      choices,
    });

    if (selected) {
      context.config.defaultModel = selected;
      await context.saveConfig();
      console.log(green(`\n✓ Default model set to: ${selected}`));
    }
    console.log();
  } catch (error) {
    if (error instanceof Error && !error.message.includes('abort')) {
      console.log(red(`Error: ${error.message}`));
    }
  }
}




