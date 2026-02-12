import { bold, cyan, gray, green, yellow, red, magenta } from '../utils/colors.ts';
import type { Command, CommandContext } from '../types/index.ts';
import { getAllCommands, formatCommandHelp } from './registry.ts';

export const helpCommand: Command = {
  name: 'help',
  aliases: ['h', '?'],
  description: 'Show available commands',
  async execute(args: string[], context: CommandContext) {
    const commands = getAllCommands();
    
    console.log(bold('\nAvailable commands:\n'));

    // Group commands by category
    const repoCommands = commands.filter(c => ['repo', 'repos'].includes(c.name));
    const issueCommands = commands.filter(c => ['issue', 'issues'].includes(c.name));
    const prCommands = commands.filter(c => ['pr', 'prs'].includes(c.name));
    const worktreeCommands = commands.filter(c => ['worktree', 'worktrees'].includes(c.name));
    const aiCommands = commands.filter(c => ['fix', 'review', 'test', 'verify', 'checkout'].includes(c.name));
    const configCommands = commands.filter(c => ['config'].includes(c.name));
    const otherCommands = commands.filter(c => ['help', 'exit', 'quit'].includes(c.name));

    if (repoCommands.length > 0) {
      console.log(cyan('  Repository:'));
      for (const cmd of repoCommands) {
        console.log(gray('    ' + formatCommandHelp(cmd)));
      }
    }

    if (issueCommands.length > 0) {
      console.log(cyan('\n  Issues:'));
      for (const cmd of issueCommands) {
        console.log(gray('    ' + formatCommandHelp(cmd)));
      }
    }

    if (prCommands.length > 0) {
      console.log(cyan('\n  Pull Requests:'));
      for (const cmd of prCommands) {
        console.log(gray('    ' + formatCommandHelp(cmd)));
      }
    }

    if (worktreeCommands.length > 0) {
      console.log(cyan('\n  Worktrees:'));
      for (const cmd of worktreeCommands) {
        console.log(gray('    ' + formatCommandHelp(cmd)));
      }
    }

    if (aiCommands.length > 0) {
      console.log(cyan('\n  AI Commands:'));
      for (const cmd of aiCommands) {
        console.log(gray('    ' + formatCommandHelp(cmd)));
      }
    }

    if (configCommands.length > 0) {
      console.log(cyan('\n  Configuration:'));
      for (const cmd of configCommands) {
        console.log(gray('    ' + formatCommandHelp(cmd)));
      }
    }

    if (otherCommands.length > 0) {
      console.log(cyan('\n  Other:'));
      for (const cmd of otherCommands) {
        console.log(gray('    ' + formatCommandHelp(cmd)));
      }
    }

    console.log();
    console.log(gray('  Type / to see this help. Press Ctrl+C to exit.\n'));
  },
};

export const exitCommand: Command = {
  name: 'exit',
  aliases: ['quit', 'q'],
  description: 'Exit ghopilot',
  async execute(_args: string[], _context: CommandContext) {
    console.log(gray('\nGoodbye!\n'));
    process.exit(0);
  },
};



