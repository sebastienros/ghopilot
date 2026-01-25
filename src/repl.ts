import * as readline from 'readline';
import chalk from 'chalk';
import type { Config, CommandContext } from './types/index.js';
import { loadConfig, saveConfig, formatRepoName } from './utils/config.js';
import { executeCommand, registerCommand, getAllCommands } from './commands/registry.js';
import { repoCommand, reposCommand } from './commands/repos.js';
import { configCommand } from './commands/config.js';
import { promptCommand, promptsCommand } from './commands/prompts.js';
import { issueCommand, issuesCommand } from './commands/issues.js';
import { prCommand, prsCommand } from './commands/prs.js';
import { worktreeCommand, worktreesCommand } from './commands/worktrees.js';
import { helpCommand, exitCommand } from './commands/help.js';
import { fixCommand, reviewCommand, testCommand, verifyCommand, checkoutCommand, submitPrCommand, explainCommand } from './commands/ai.js';

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
      parts.push(chalk.cyan(formatRepoName(currentConfig.activeRepository)));
    }
    
    if (currentConfig.activeIssue) {
      parts.push(chalk.yellow(`#${currentConfig.activeIssue}`));
    } else if (currentConfig.activePR) {
      parts.push(chalk.magenta(`PR#${currentConfig.activePR}`));
    }

    if (parts.length > 0) {
      return parts.join(' ') + ' ';
    }
    
    return '';
  };

  const showCommandPalette = async (): Promise<string | null> => {
    const commands = getAllCommands();
    
    // Calculate visible length (strip ANSI codes)
    const stripAnsi = (str: string) => str.replace(/\x1b\[[0-9;]*m/g, '');
    
    return new Promise((resolve) => {
      let input = '';
      let selectedIndex = 0;
      let filteredCommands = commands;
      
      const getFiltered = () => {
        const term = input.toLowerCase().trim();
        
        // If input has spaces, it's a full command
        if (term.includes(' ')) {
          const cmdName = term.split(' ')[0];
          const cmd = commands.find(c => c.name === cmdName || c.aliases?.includes(cmdName));
          if (cmd) {
            return [{ ...cmd, _fullCommand: true }];
          }
        }
        
        return commands.filter(cmd => {
          if (!term) return true;
          return cmd.name.toLowerCase().includes(term) ||
                 cmd.description.toLowerCase().includes(term) ||
                 cmd.aliases?.some(a => a.toLowerCase().includes(term));
        });
      };
      
      const render = () => {
        const prefix = getPromptPrefix();
        const prefixLen = stripAnsi(prefix).length;
        
        // Clear previous render
        process.stdout.write('\x1b[2K\x1b[G'); // Clear line, move to start
        
        // Draw input line
        process.stdout.write(prefix + chalk.cyan('/') + input);
        
        // Draw dropdown below
        const maxItems = 8;
        const startIdx = Math.max(0, selectedIndex - maxItems + 1);
        const visibleItems = filteredCommands.slice(startIdx, startIdx + maxItems);
        
        // Move to next lines for menu
        for (let i = 0; i < visibleItems.length; i++) {
          const cmd = visibleItems[i];
          const actualIdx = startIdx + i;
          const isSelected = actualIdx === selectedIndex;
          
          process.stdout.write('\n\x1b[2K'); // New line, clear it
          
          // Build argument hints
          let argHint = '';
          if (cmd.args && cmd.args.length > 0) {
            argHint = ' ' + chalk.yellow(cmd.args.map((a: { name: string; required: boolean }) => 
              a.required ? `<${a.name}>` : `[${a.name}]`
            ).join(' '));
          }
          
          const marker = isSelected ? chalk.cyan('❯ ') : '  ';
          const name = (cmd as any)._fullCommand 
            ? chalk.green(`▶ Execute: /${input}`)
            : chalk.cyan(`/${cmd.name}`) + argHint + chalk.gray(` - ${cmd.description}`);
          
          process.stdout.write(marker + name);
        }
        
        // Help line
        process.stdout.write('\n\x1b[2K' + chalk.gray('↑↓ navigate • ⏎ select • esc cancel'));
        
        // Move cursor back to input line (column = prefix + "/" + input)
        const linesToMove = visibleItems.length + 1;
        const cursorCol = prefixLen + 1 + input.length + 1;
        process.stdout.write(`\x1b[${linesToMove}A\x1b[${cursorCol}G`);
      };
      
      const cleanup = (linesToClear: number) => {
        // Clear the menu lines
        for (let i = 0; i < linesToClear; i++) {
          process.stdout.write('\n\x1b[2K');
        }
        // Move back up and clear input line
        process.stdout.write(`\x1b[${linesToClear}A\x1b[2K\x1b[G`);
        
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(false);
        }
        process.stdin.removeListener('data', onData);
      };
      
      const onData = (data: Buffer) => {
        const key = data[0];
        
        // Escape
        if (key === 27 && data.length === 1) {
          cleanup(filteredCommands.slice(0, 8).length + 1);
          resolve(null);
          return;
        }
        
        // Escape sequences (arrows)
        if (key === 27 && data.length > 1) {
          if (data[1] === 91) { // [
            if (data[2] === 65) { // Up arrow
              selectedIndex = Math.max(0, selectedIndex - 1);
              render();
            } else if (data[2] === 66) { // Down arrow
              selectedIndex = Math.min(filteredCommands.length - 1, selectedIndex + 1);
              render();
            }
          }
          return;
        }
        
        // Enter
        if (key === 13) {
          cleanup(filteredCommands.slice(0, 8).length + 1);
          const selected = filteredCommands[selectedIndex];
          if (selected) {
            if ((selected as any)._fullCommand) {
              resolve(`__exec__${input}`);
            } else {
              resolve(selected.name);
            }
          } else {
            resolve(null);
          }
          return;
        }
        
        // Ctrl+C
        if (key === 3) {
          cleanup(filteredCommands.slice(0, 8).length + 1);
          resolve('__exit__');
          return;
        }
        
        // Backspace
        if (key === 127 || key === 8) {
          if (input.length > 0) {
            input = input.slice(0, -1);
            filteredCommands = getFiltered();
            selectedIndex = 0;
            // Clear old menu first
            const oldLen = Math.min(8, commands.length) + 1;
            for (let i = 0; i < oldLen; i++) {
              process.stdout.write('\n\x1b[2K');
            }
            process.stdout.write(`\x1b[${oldLen}A`);
            render();
          }
          return;
        }
        
        // Regular character
        if (key >= 32 && key < 127) {
          input += String.fromCharCode(key);
          filteredCommands = getFiltered();
          selectedIndex = 0;
          // Clear old menu first
          const oldLen = Math.min(8, commands.length) + 1;
          for (let i = 0; i < oldLen; i++) {
            process.stdout.write('\n\x1b[2K');
          }
          process.stdout.write(`\x1b[${oldLen}A`);
          render();
        }
      };
      
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
      }
      process.stdin.resume();
      process.stdin.on('data', onData);
      
      filteredCommands = getFiltered();
      render();
    });
  };

  // Show initial status
  console.log(chalk.gray('Type / for commands. Press Ctrl+C to exit.\n'));

  // Main REPL loop
  const runLoop = async (): Promise<void> => {
    while (true) {
      // Show prompt and wait for "/" keypress
      process.stdout.write(getPromptPrefix() + chalk.gray('> '));
      
      // Wait for "/" key
      const key = await waitForSlashKey();
      
      if (key === 'exit') {
        console.log(chalk.gray('\nGoodbye!\n'));
        process.exit(0);
      }
      
      if (key === '/') {
        try {
          const selectedCommand = await showCommandPalette();
          
          if (selectedCommand) {
            if (selectedCommand === '__exit__') {
              console.log(chalk.gray('\nGoodbye!\n'));
              process.exit(0);
            }
          
            // Check if it's a full command to execute directly
            if (selectedCommand.startsWith('__exec__')) {
              const fullCommand = selectedCommand.slice(8); // Remove __exec__ prefix
              await executeCommand(`/${fullCommand}`, context);
            } else {
              const cmd = getAllCommands().find(c => c.name === selectedCommand);
              
              // Only prompt for args if command has REQUIRED args
              if (cmd?.args && cmd.args.some(a => a.required)) {
                const args = await promptForArgs(cmd.name, cmd.args);
                if (args !== null) {
                  await executeCommand(`/${selectedCommand} ${args}`.trim(), context);
                }
              } else {
                await executeCommand(`/${selectedCommand}`, context);
              }
            }
          }
        } catch (error) {
          // Escape pressed or error - continue the loop
        }
      }
    }
  };

  runLoop();
}

function waitForSlashKey(): Promise<string> {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    
    const onData = (data: Buffer) => {
      const char = data.toString();
      
      // Ctrl+C
      if (char === '\x03') {
        process.stdin.removeListener('data', onData);
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(false);
        }
        resolve('exit');
        return;
      }
      
      // "/" key
      if (char === '/') {
        process.stdin.removeListener('data', onData);
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(false);
        }
        resolve('/');
        return;
      }
    };
    
    process.stdin.on('data', onData);
  });
}

function promptForArgs(cmdName: string, args: { name: string; required: boolean }[]): Promise<string | null> {
  return new Promise((resolve) => {
    const argHints = args.map(a => a.required ? `<${a.name}>` : `[${a.name}]`).join(' ');
    
    // Show the command with hints
    process.stdout.write(chalk.cyan(`/${cmdName} `) + chalk.yellow(argHints) + '\n');
    process.stdout.write(chalk.cyan(`/${cmdName} `));
    
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    
    // Handle escape key
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    
    let input = '';
    let resolved = false;
    
    const cleanup = () => {
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      rl.close();
    };
    
    process.stdin.on('data', function onData(data: Buffer) {
      if (resolved) return;
      
      // Escape key
      if (data[0] === 27 && data.length === 1) {
        resolved = true;
        process.stdin.removeListener('data', onData);
        cleanup();
        process.stdout.write('\n');
        resolve(null);
        return;
      }
      
      // Enter key
      if (data[0] === 13 || data[0] === 10) {
        resolved = true;
        process.stdin.removeListener('data', onData);
        cleanup();
        process.stdout.write('\n');
        resolve(input);
        return;
      }
      
      // Ctrl+C
      if (data[0] === 3) {
        resolved = true;
        process.stdin.removeListener('data', onData);
        cleanup();
        process.stdout.write('\n');
        resolve(null);
        return;
      }
      
      // Backspace
      if (data[0] === 127 || data[0] === 8) {
        if (input.length > 0) {
          input = input.slice(0, -1);
          process.stdout.write('\b \b');
        }
        return;
      }
      
      // Regular character
      const char = data.toString();
      if (char.length === 1 && data[0] >= 32) {
        input += char;
        process.stdout.write(char);
      }
    });
  });
}
