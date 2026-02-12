import type { Command, CommandContext } from '../types/index.ts';

const commands: Map<string, Command> = new Map();
const aliases: Map<string, string> = new Map();

export function registerCommand(command: Command): void {
  commands.set(command.name, command);
  if (command.aliases) {
    for (const alias of command.aliases) {
      aliases.set(alias, command.name);
    }
  }
}

export function getCommand(name: string): Command | undefined {
  const resolved = aliases.get(name) || name;
  return commands.get(resolved);
}

export function getAllCommands(): Command[] {
  return Array.from(commands.values());
}

export function getCommandNames(): string[] {
  const names = Array.from(commands.keys());
  const aliasNames = Array.from(aliases.keys());
  return [...names, ...aliasNames].sort();
}

export function parseInput(input: string): { command: string; args: string[] } | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) {
    return null;
  }

  const parts = trimmed.slice(1).split(/\s+/);
  const command = parts[0] || '';
  const args = parts.slice(1);

  return { command, args };
}

export async function executeCommand(input: string, context: CommandContext): Promise<boolean> {
  const parsed = parseInput(input);
  if (!parsed) {
    return false;
  }

  const { command: cmdName, args } = parsed;
  
  // Handle empty command (just /) - show help
  if (!cmdName) {
    const helpCmd = getCommand('help');
    if (helpCmd) {
      await helpCmd.execute([], context);
    }
    return true;
  }

  const command = getCommand(cmdName);
  if (!command) {
    console.log(`Unknown command: /${cmdName}. Type / for help.`);
    return true;
  }

  try {
    await command.execute(args, context);
  } catch (error) {
    if (error instanceof Error) {
      console.error(`Error: ${error.message}`);
    } else {
      console.error('An unknown error occurred');
    }
  }

  return true;
}

export function getCompletions(partial: string): string[] {
  if (!partial.startsWith('/')) {
    return [];
  }

  const search = partial.slice(1).toLowerCase();
  const names = getCommandNames();

  if (!search) {
    return names.map(n => `/${n}`);
  }

  return names
    .filter(n => n.toLowerCase().startsWith(search))
    .map(n => `/${n}`);
}

export function formatCommandHelp(command: Command): string {
  let help = `/${command.name}`;
  
  if (command.args) {
    for (const arg of command.args) {
      if (arg.required) {
        help += ` <${arg.name}>`;
      } else {
        help += ` [${arg.name}]`;
      }
    }
  }

  help += ` - ${command.description}`;
  return help;
}
