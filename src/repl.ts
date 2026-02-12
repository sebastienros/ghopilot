import * as readline from 'readline';
import { bold, cyan, gray, green, yellow } from './utils/colors.ts';
import type { Config, CommandContext } from './types/index.ts';
import { loadConfig, saveConfig, formatRepoName } from './utils/config.ts';
import { executeCommand, registerCommand, getAllCommands } from './commands/registry.ts';
import { repoCommand, reposCommand } from './commands/repos.ts';
import { configCommand } from './commands/config.ts';
import { promptCommand, promptsCommand } from './commands/prompts.ts';
import { issueCommand, issuesCommand } from './commands/issues.ts';
import { prCommand, prsCommand } from './commands/prs.ts';
import { worktreeCommand, worktreesCommand } from './commands/worktrees.ts';
import { helpCommand, exitCommand } from './commands/help.ts';
import { fixCommand, reviewCommand, testCommand, verifyCommand, checkoutCommand, submitPrCommand, explainCommand } from './commands/ai.ts';
import { noteCommand, notesCommand, clearNoteCommand } from './commands/notes.ts';
import { flagCommand, flaggedCommand, unflagCommand } from './commands/flag.ts';
import { pinCommand, unpinCommand } from './commands/pin.ts';
import { modelCommand, modelsCommand } from './commands/model.ts';

// Register all commands
registerCommand(repoCommand);
registerCommand(reposCommand);
registerCommand(configCommand);
registerCommand(promptCommand);
registerCommand(promptsCommand);
registerCommand(issueCommand);
registerCommand(issuesCommand);
registerCommand(prCommand);
registerCommand(prsCommand);
registerCommand(worktreeCommand);
registerCommand(worktreesCommand);
registerCommand(helpCommand);
registerCommand(exitCommand);
registerCommand(fixCommand);
registerCommand(reviewCommand);
registerCommand(testCommand);
registerCommand(verifyCommand);
registerCommand(checkoutCommand);
registerCommand(submitPrCommand);
registerCommand(explainCommand);
registerCommand(noteCommand);
registerCommand(notesCommand);
registerCommand(clearNoteCommand);
registerCommand(flagCommand);
registerCommand(flaggedCommand);
registerCommand(unflagCommand);
registerCommand(pinCommand);
registerCommand(unpinCommand);
registerCommand(modelCommand);
registerCommand(modelsCommand);

export async function startRepl(config: Config): Promise<void> {
  let currentConfig = config;
  let currentCwd = process.cwd();

  const context: CommandContext = {
    get config() { return currentConfig; },
    set config(c: Config) { currentConfig = c; },
    async saveConfig() {
      await saveConfig(currentConfig);
    },
    async reloadConfig() {
      currentConfig = await loadConfig();
    },
    get cwd() { return currentCwd; },
    setCwd(path: string) {
      currentCwd = path;
      process.chdir(path);
    },
  };

  const getPromptPrefix = (): string => {
    const parts: string[] = [];
    
    if (currentConfig.activeRepository) {
      parts.push(cyan(formatRepoName(currentConfig.activeRepository)));
    }
    
    if (currentConfig.activeIssue) {
      parts.push(yellow(`#${currentConfig.activeIssue}`));
    } else if (currentConfig.activePR) {
      parts.push(`PR#${currentConfig.activePR}`);
    }

    if (parts.length > 0) {
      return parts.join(' ') + ' ';
    }
    
    return '';
  };

  // Show initial status
  console.log(gray('Type / followed by a command. Press Ctrl+C to exit.\n'));

  // Main REPL loop using readline
  const promptUser = () => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(getPromptPrefix() + gray('> '), async (input) => {
      rl.close();
      // Keep the event loop alive while commands run async operations
      process.stdin.ref();
      process.stdin.resume();

      const trimmed = input.trim();
      
      if (!trimmed) {
        promptUser();
        return;
      }

      if (trimmed === '/exit' || trimmed === '/quit' || trimmed === '/q') {
        console.log(gray('\nGoodbye!\n'));
        process.exit(0);
      }

      if (trimmed.startsWith('/')) {
        try {
          await executeCommand(trimmed, context);
        } catch (error) {
          // Command error, continue
        }
      } else {
        // Treat as slash command if it looks like a command name
        try {
          await executeCommand(`/${trimmed}`, context);
        } catch {
          console.log(gray('Type / followed by a command name. Use /help for a list.'));
        }
      }

      process.stdin.pause();
      promptUser();
    });

    rl.on('close', () => {
      // Only exit if we didn't close it ourselves (e.g. Ctrl+C)
    });
  };

  // Handle Ctrl+C
  process.on('SIGINT', () => {
    console.log(gray('\nGoodbye!\n'));
    process.exit(0);
  });

  promptUser();
}

