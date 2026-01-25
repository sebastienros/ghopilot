import chalk from 'chalk';
import type { Command, CommandContext } from '../types/index.js';
import { 
  addRepository, 
  removeRepository, 
  selectRepository, 
  getRecentRepositories,
  formatRepoName,
  parseRepoName,
  getRepoLocalPath,
  getReposPath
} from '../utils/config.js';
import { select, input, search } from '@inquirer/prompts';

export const repoCommand: Command = {
  name: 'repo',
  description: 'Manage repositories',
  args: [
    { name: 'list|add|remove|select', description: 'Subcommand', required: false },
    { name: 'owner/repo', description: 'Repository name', required: false },
  ],
  async execute(args: string[], context: CommandContext) {
    const [subcommand, name] = args;

    if (!subcommand) {
      // Show interactive repository selector
      await selectRepoInteractive(context);
      return;
    }

    switch (subcommand) {
      case 'list':
        await listRepositories(context);
        break;
      case 'add':
        await addRepo(name, context);
        break;
      case 'remove':
        await removeRepo(name, context);
        break;
      case 'select':
        await selectRepo(name, context);
        break;
      default:
        // If it's a repo name, select it
        const parsed = parseRepoName(subcommand);
        if (parsed) {
          await selectRepo(subcommand, context);
        } else {
          console.log(chalk.red(`Unknown subcommand: ${subcommand}`));
          console.log('Usage: /repo [list|add|remove|select] [owner/repo]');
        }
    }
  },
};

export const reposCommand: Command = {
  name: 'repos',
  aliases: ['repositories'],
  description: 'List configured repositories',
  async execute(_args: string[], context: CommandContext) {
    await listRepositories(context);
  },
};

async function listRepositories(context: CommandContext): Promise<void> {
  const repos = getRecentRepositories(context.config);
  
  if (repos.length === 0) {
    console.log(chalk.yellow('No repositories configured. Use /repo add <owner/repo> to add one.'));
    return;
  }

  console.log(chalk.bold('\nConfigured repositories:\n'));
  for (const repo of repos) {
    const name = formatRepoName(repo);
    const isActive = context.config.activeRepository?.owner === repo.owner && 
                     context.config.activeRepository?.repo === repo.repo;
    
    if (isActive) {
      console.log(chalk.green(`  ● ${name}`) + chalk.gray(' (active)'));
    } else {
      console.log(chalk.gray(`  ○ ${name}`));
    }
  }
  console.log();
}

async function selectRepoInteractive(context: CommandContext): Promise<void> {
  const repos = getRecentRepositories(context.config);
  
  if (repos.length === 0) {
    console.log(chalk.yellow('No repositories configured. Use /repo add <owner/repo> to add one.'));
    return;
  }

  try {
    const selected = await search({
      message: 'Select repository:',
      source: async (input) => {
        const term = (input || '').toLowerCase();
        
        const filtered = repos.filter(repo => {
          if (!term) return true;
          const name = formatRepoName(repo).toLowerCase();
          return name.includes(term);
        });
        
        return [
          ...filtered.map(repo => {
            const name = formatRepoName(repo);
            const isActive = context.config.activeRepository?.owner === repo.owner && 
                           context.config.activeRepository?.repo === repo.repo;
            return {
              name: isActive 
                ? chalk.green(`● ${name}`) + chalk.gray(' (active)')
                : `○ ${name}`,
              value: name,
            };
          }),
          { name: chalk.gray('+ Add a new repository'), value: '__add__' },
        ];
      },
    });

    if (selected === '__add__') {
      await addRepo(undefined, context);
    } else {
      const parsed = parseRepoName(selected);
      if (parsed) {
        selectRepository(context.config, parsed.owner, parsed.repo);
        await context.saveConfig();
        console.log(chalk.green(`Selected: ${selected}`));
      }
    }
  } catch (error) {
    // User pressed escape or ctrl+c
  }
}

async function addRepo(name: string | undefined, context: CommandContext): Promise<void> {
  let repoName = name;
  
  if (!repoName) {
    repoName = await input({
      message: 'Enter repository (owner/repo):',
    });
  }

  const parsed = parseRepoName(repoName);
  if (!parsed) {
    console.log(chalk.red('Invalid repository format. Use owner/repo'));
    return;
  }

  console.log(chalk.gray(`\nCloning ${repoName}...`));
  
  try {
    const result = await addRepository(context.config, parsed.owner, parsed.repo);
    await context.saveConfig();
    
    if (result.cloned) {
      console.log(chalk.green(`✓ Cloned ${repoName} to ${result.localPath}`));
    } else {
      console.log(chalk.green(`✓ Added ${repoName} (already exists at ${result.localPath})`));
    }
  } catch (error) {
    if (error instanceof Error) {
      console.log(chalk.red(`Failed to clone repository: ${error.message}`));
    }
  }
}

async function removeRepo(name: string | undefined, context: CommandContext): Promise<void> {
  let repoName = name;
  
  if (!repoName && context.config.repositories.length > 0) {
    const choices = context.config.repositories.map(r => ({
      name: formatRepoName(r),
      value: formatRepoName(r),
    }));
    
    repoName = await select({
      message: 'Select repository to remove:',
      choices,
    });
  }

  if (!repoName) {
    console.log(chalk.yellow('No repositories to remove.'));
    return;
  }

  const parsed = parseRepoName(repoName);
  if (!parsed) {
    console.log(chalk.red('Invalid repository format. Use owner/repo'));
    return;
  }

  await removeRepository(context.config, parsed.owner, parsed.repo);
  await context.saveConfig();
  console.log(chalk.green(`Removed ${repoName}`));
}

async function selectRepo(name: string | undefined, context: CommandContext): Promise<void> {
  let repoName = name;
  
  if (!repoName && context.config.repositories.length > 0) {
    const repos = getRecentRepositories(context.config);
    const choices = repos.map(r => ({
      name: formatRepoName(r),
      value: formatRepoName(r),
    }));
    
    repoName = await select({
      message: 'Select repository:',
      choices,
    });
  }

  if (!repoName) {
    console.log(chalk.yellow('No repositories configured. Use /repo add <owner/repo> first.'));
    return;
  }

  const parsed = parseRepoName(repoName);
  if (!parsed) {
    console.log(chalk.red('Invalid repository format. Use owner/repo'));
    return;
  }

  const exists = context.config.repositories.some(
    r => r.owner === parsed.owner && r.repo === parsed.repo
  );

  if (!exists) {
    await addRepository(context.config, parsed.owner, parsed.repo);
  }

  selectRepository(context.config, parsed.owner, parsed.repo);
  await context.saveConfig();
  console.log(chalk.green(`Selected ${repoName}`));
}
