import chalk from 'chalk';
import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import type { Command, CommandContext, Worktree } from '../types/index.js';
import { confirm } from '@inquirer/prompts';
import { getRepoLocalPath, expandPath } from '../utils/config.js';

function getRepoPath(context: CommandContext): string {
  const repo = context.config.activeRepository;
  if (!repo) {
    return context.cwd;
  }
  
  // First check if repo has a localPath in config
  const repoConfig = context.config.repositories.find(
    r => r.owner === repo.owner && r.repo === repo.repo
  );
  if (repoConfig?.localPath) {
    return expandPath(repoConfig.localPath);
  }
  
  // Fall back to computed path (already expanded)
  return getRepoLocalPath(context.config, repo.owner, repo.repo);
}

export const worktreeCommand: Command = {
  name: 'worktree',
  description: 'Manage worktrees',
  args: [
    { name: 'list|remove|clean', description: 'Subcommand', required: false },
    { name: 'number', description: 'Issue/PR number', required: false },
  ],
  async execute(args: string[], context: CommandContext) {
    const [subcommand, number] = args;

    if (!subcommand || subcommand === 'list') {
      await listWorktrees(context);
      return;
    }

    switch (subcommand) {
      case 'remove':
        if (number) {
          await removeWorktree(parseInt(number, 10), context);
        } else {
          console.log(chalk.red('Usage: /worktree remove <number>'));
        }
        break;
      case 'clean':
        await cleanWorktrees(context);
        break;
      default:
        console.log(chalk.red(`Unknown subcommand: ${subcommand}`));
        console.log('Usage: /worktree [list|remove|clean] [number]');
    }
  },
};

export const worktreesCommand: Command = {
  name: 'worktrees',
  description: 'List all ghopilot worktrees',
  async execute(_args: string[], context: CommandContext) {
    await listWorktrees(context);
  },
};

export function getWorktrees(context: CommandContext): Worktree[] {
  const worktrees: Worktree[] = [];
  
  try {
    // Get git worktree list
    const repoPath = getRepoPath(context);
    const output = execSync('git worktree list --porcelain', { 
      cwd: repoPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const lines = output.split('\n');
    let currentWorktree: Partial<Worktree> = {};

    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        currentWorktree.path = line.slice(9);
      } else if (line.startsWith('branch ')) {
        currentWorktree.branch = line.slice(7).replace('refs/heads/', '');
      } else if (line === '') {
        if (currentWorktree.path && currentWorktree.branch) {
          // Check if it's a ghopilot worktree
          const match = currentWorktree.path.match(/-ghopilot-(\d+)$/);
          if (match) {
            worktrees.push({
              path: currentWorktree.path,
              branch: currentWorktree.branch,
              number: parseInt(match[1], 10),
              type: 'issue', // We can't easily distinguish, but it doesn't matter
            });
          }
        }
        currentWorktree = {};
      }
    }
  } catch {
    // Not a git repository or git worktree not available
  }

  return worktrees;
}

export function getWorktreeForNumber(number: number, context: CommandContext): Worktree | undefined {
  const worktrees = getWorktrees(context);
  return worktrees.find(w => w.number === number);
}

export async function checkAndSwitchWorktree(number: number, context: CommandContext): Promise<boolean> {
  const worktree = getWorktreeForNumber(number, context);
  if (worktree && fs.existsSync(worktree.path)) {
    context.setCwd(worktree.path);
    console.log(chalk.cyan(`\n📁 Worktree exists for #${number}`));
    console.log(chalk.gray(`   Path: ${worktree.path}`));
    console.log(chalk.gray(`   Branch: ${worktree.branch}`));
    console.log();
    console.log(chalk.gray('Available commands:'));
    console.log(chalk.gray('  /fix      - Continue working on this issue'));
    console.log(chalk.gray('  /review   - Review the current changes'));
    console.log(chalk.gray('  /test     - Generate tests'));
    console.log(chalk.gray('  /submit   - Submit a PR'));
    console.log(chalk.gray('  /explain  - Explain the issue'));
    console.log();
    return true;
  }
  return false;
}

export function getWorktreePath(repoName: string, number: number, basePath: string): string {
  const parentDir = path.dirname(basePath);
  return path.join(parentDir, `${repoName}-ghopilot-${number}`);
}

export async function createWorktree(
  number: number, 
  branchName: string, 
  context: CommandContext
): Promise<string> {
  const repo = context.config.activeRepository;
  if (!repo) {
    throw new Error('No repository selected');
  }

  const repoPath = getRepoPath(context);
  const worktreePath = getWorktreePath(repo.repo, number, repoPath);
  
  // Verify repo path exists, offer to clone if not
  if (!fs.existsSync(repoPath)) {
    console.log(chalk.yellow(`Repository not found at: ${repoPath}`));
    
    const shouldClone = await confirm({
      message: `Clone ${repo.owner}/${repo.repo}?`,
      default: true,
    });
    
    if (!shouldClone) {
      throw new Error('Repository not cloned');
    }
    
    // Clone the repository
    const parentDir = path.dirname(repoPath);
    fs.mkdirSync(parentDir, { recursive: true });
    
    console.log(chalk.gray(`Cloning ${repo.owner}/${repo.repo}...`));
    execSync(`gh repo clone ${repo.owner}/${repo.repo} "${repoPath}"`, {
      stdio: 'inherit',
    });
    console.log(chalk.green(`✓ Cloned to ${repoPath}`));
    
    // Update config with localPath
    const repoConfig = context.config.repositories.find(
      r => r.owner === repo.owner && r.repo === repo.repo
    );
    if (repoConfig) {
      repoConfig.localPath = repoPath;
      await context.saveConfig();
    }
  }
  
  // Check if worktree already exists
  if (fs.existsSync(worktreePath)) {
    console.log(chalk.yellow(`Worktree already exists at ${worktreePath}`));
    return worktreePath;
  }

  // Create worktree with new branch
  try {
    execSync(`git worktree add -b "${branchName}" "${worktreePath}"`, {
      cwd: repoPath,
      stdio: 'inherit',
    });
    console.log(chalk.green(`Created worktree at ${worktreePath}`));
    console.log(chalk.gray(`Branch: ${branchName}`));
  } catch (error) {
    // Branch might already exist, try without -b
    try {
      execSync(`git worktree add "${worktreePath}" "${branchName}"`, {
        cwd: repoPath,
        stdio: 'inherit',
      });
      console.log(chalk.green(`Created worktree at ${worktreePath}`));
    } catch (e) {
      throw new Error(`Failed to create worktree: ${e}`);
    }
  }

  return worktreePath;
}

async function listWorktrees(context: CommandContext): Promise<void> {
  const worktrees = getWorktrees(context);

  if (worktrees.length === 0) {
    console.log(chalk.yellow('\nNo ghopilot worktrees found.\n'));
    return;
  }

  console.log(chalk.bold('\nghopilot worktrees:\n'));

  for (const wt of worktrees) {
    const activeNumber = context.config.activeIssue || context.config.activePR;
    const isActive = wt.number === activeNumber;
    const prefix = isActive ? chalk.cyan('● ') : '  ';
    const exists = fs.existsSync(wt.path);
    const status = exists ? '' : chalk.red(' (missing)');

    console.log(
      prefix +
      chalk.bold(`#${wt.number}`) + ' ' +
      chalk.gray(wt.branch) +
      status
    );
    console.log(chalk.gray(`    ${wt.path}`));
  }
  console.log();
}

async function removeWorktree(number: number, context: CommandContext): Promise<void> {
  const worktree = getWorktreeForNumber(number, context);
  
  if (!worktree) {
    console.log(chalk.yellow(`No worktree found for #${number}`));
    return;
  }

  const shouldDelete = await confirm({
    message: `Remove worktree for #${number} at ${worktree.path}?`,
    default: false,
  });

  if (!shouldDelete) {
    console.log(chalk.gray('Cancelled.'));
    return;
  }

  try {
    const repoPath = getRepoPath(context);
    execSync(`git worktree remove "${worktree.path}" --force`, {
      cwd: repoPath,
      stdio: 'pipe',
    });
    console.log(chalk.green(`Removed worktree: ${worktree.path}`));

    // Optionally delete the branch
    const deleteBranch = await confirm({
      message: `Also delete branch ${worktree.branch}?`,
      default: false,
    });

    if (deleteBranch) {
      try {
        execSync(`git branch -D "${worktree.branch}"`, {
          cwd: repoPath,
          stdio: 'pipe',
        });
        console.log(chalk.green(`Deleted branch: ${worktree.branch}`));
      } catch {
        console.log(chalk.yellow(`Could not delete branch ${worktree.branch}`));
      }
    }
  } catch (error) {
    console.log(chalk.red(`Failed to remove worktree: ${error}`));
  }
}

async function cleanWorktrees(context: CommandContext): Promise<void> {
  const worktrees = getWorktrees(context);

  if (worktrees.length === 0) {
    console.log(chalk.yellow('No ghopilot worktrees to clean.'));
    return;
  }

  console.log(chalk.yellow(`\nFound ${worktrees.length} ghopilot worktree(s):`));
  for (const wt of worktrees) {
    console.log(chalk.gray(`  #${wt.number} - ${wt.path}`));
  }
  console.log();

  const shouldClean = await confirm({
    message: 'Remove all ghopilot worktrees?',
    default: false,
  });

  if (!shouldClean) {
    console.log(chalk.gray('Cancelled.'));
    return;
  }

  const repoPath = getRepoPath(context);
  
  for (const wt of worktrees) {
    try {
      execSync(`git worktree remove "${wt.path}" --force`, {
        cwd: repoPath,
        stdio: 'pipe',
      });
      console.log(chalk.green(`Removed: ${wt.path}`));
    } catch {
      console.log(chalk.yellow(`Could not remove: ${wt.path}`));
    }
  }

  // Prune worktrees
  try {
    execSync('git worktree prune', { cwd: repoPath, stdio: 'pipe' });
  } catch {
    // Ignore
  }

  console.log(chalk.green('\nWorktree cleanup complete.'));
}
