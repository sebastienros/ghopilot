import { bold, cyan, gray, green, yellow, red, magenta } from '../utils/colors.ts';
import { join, dirname } from 'path';
import { existsSync, mkdirSync } from 'fs';
import type { Command, CommandContext, Worktree } from '../types/index.ts';
import { getRepoLocalPath, expandPath } from '../utils/config.ts';
import { confirmPrompt } from '../utils/ui.ts';

// Validate branch name to prevent command injection
function isValidBranchName(name: string): boolean {
  // Git branch names: alphanumeric, dash, underscore, slash, dot (no spaces or shell metacharacters)
  return /^[a-zA-Z0-9._\/-]+$/.test(name);
}

// Validate path doesn't contain shell metacharacters
function isValidPath(p: string): boolean {
  // Reject paths with shell metacharacters
  return !/[;&|`$(){}[\]<>!]/.test(p);
}

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
          console.log(red('Usage: /worktree remove <number>'));
        }
        break;
      case 'clean':
        await cleanWorktrees(context);
        break;
      default:
        console.log(red(`Unknown subcommand: ${subcommand}`));
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
    const result = Bun.spawnSync(['git', 'worktree', 'list', '--porcelain'], { 
      cwd: repoPath,
            stdout: 'pipe', stderr: 'pipe'
    });
    const output = result.stdout?.toString() || '';

    const lines = output.split('\n');
    let currentWorktree: Partial<Worktree> = {};
    
    // Get the active repository name to filter worktrees
    const activeRepoName = context.config.activeRepository?.repo;

    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        currentWorktree.path = line.slice(9);
      } else if (line.startsWith('branch ')) {
        currentWorktree.branch = line.slice(7).replace('refs/heads/', '');
      } else if (line === '') {
        if (currentWorktree.path && currentWorktree.branch) {
          // Check if it's a ghopilot worktree for the active repository
          const repoPattern = activeRepoName 
            ? new RegExp(`${activeRepoName}-ghopilot-(\\d+)$`)
            : /-ghopilot-(\d+)$/;
          const match = currentWorktree.path.match(repoPattern);
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
  if (worktree && existsSync(worktree.path)) {
    context.setCwd(worktree.path);
    console.log(cyan(`\n📁 Worktree exists for #${number}`));
    console.log(gray(`   Path: ${worktree.path}`));
    console.log(gray(`   Branch: ${worktree.branch}`));
    console.log();
    console.log(gray('Available commands:'));
    console.log(gray('  /fix      - Continue working on this issue'));
    console.log(gray('  /review   - Review the current changes'));
    console.log(gray('  /test     - Generate tests'));
    console.log(gray('  /submit   - Submit a PR'));
    console.log(gray('  /explain  - Explain the issue'));
    console.log();
    return true;
  }
  return false;
}

export function getWorktreePath(repoName: string, number: number, basePath: string): string {
  const parentDir = dirname(basePath);
  return join(parentDir, `${repoName}-ghopilot-${number}`);
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

  // Validate branch name
  if (!isValidBranchName(branchName)) {
    throw new Error('Invalid branch name');
  }

  const repoPath = getRepoPath(context);
  const worktreePath = getWorktreePath(repo.repo, number, repoPath);
  
  // Validate paths
  if (!isValidPath(repoPath) || !isValidPath(worktreePath)) {
    throw new Error('Invalid path detected');
  }
  
  // Verify repo path exists, offer to clone if not
  if (!existsSync(repoPath)) {
    console.log(yellow(`Repository not found at: ${repoPath}`));
    
    const shouldClone = await confirmPrompt({
      message: `Clone ${repo.owner}/${repo.repo}?`,
      defaultValue: true,
    });
    
    if (!shouldClone) {
      throw new Error('Repository not cloned');
    }
    
    // Clone the repository (safe - using array arguments)
    const parentDir = dirname(repoPath);
    mkdirSync(parentDir, { recursive: true });
    
    console.log(gray(`Cloning ${repo.owner}/${repo.repo}...`));
    const cloneResult = Bun.spawnSync(['gh', 'repo', 'clone', `${repo.owner}/${repo.repo}`, repoPath], {
      stdio: ['inherit', 'inherit', 'inherit'],
    });
    if (cloneResult.status !== 0) {
      throw new Error('Failed to clone repository');
    }
    console.log(green(`✓ Cloned to ${repoPath}`));
    
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
  if (existsSync(worktreePath)) {
    console.log(yellow(`Worktree already exists at ${worktreePath}`));
    return worktreePath;
  }

  // Create worktree with new branch (safe - using array arguments)
  const addResult = Bun.spawnSync(['git', 'worktree', 'add', '-b', branchName, worktreePath], {
    cwd: repoPath,
    stdio: ['inherit', 'inherit', 'inherit'],
  });
  
  if (addResult.exitCode === 0) {
    console.log(green(`Created worktree at ${worktreePath}`));
    console.log(gray(`Branch: ${branchName}`));
  } else {
    // Branch might already exist, try without -b
    const addExistingResult = Bun.spawnSync(['git', 'worktree', 'add', worktreePath, branchName], {
      cwd: repoPath,
      stdio: ['inherit', 'inherit', 'inherit'],
    });
    if (addExistingResult.exitCode === 0) {
      console.log(green(`Created worktree at ${worktreePath}`));
    } else {
      throw new Error('Failed to create worktree');
    }
  }

  return worktreePath;
}

async function listWorktrees(context: CommandContext): Promise<void> {
  const worktrees = getWorktrees(context);

  if (worktrees.length === 0) {
    console.log(yellow('\nNo ghopilot worktrees found.\n'));
    return;
  }

  console.log(bold('\nghopilot worktrees:\n'));

  for (const wt of worktrees) {
    const activeNumber = context.config.activeIssue || context.config.activePR;
    const isActive = wt.number === activeNumber;
    const prefix = isActive ? cyan('● ') : '  ';
    const exists = existsSync(wt.path);
    const status = exists ? '' : red(' (missing)');

    console.log(
      prefix +
      bold(`#${wt.number}`) + ' ' +
      gray(wt.branch) +
      status
    );
    console.log(gray(`    ${wt.path}`));
  }
  console.log();
}

async function removeWorktree(number: number, context: CommandContext): Promise<void> {
  const worktree = getWorktreeForNumber(number, context);
  
  if (!worktree) {
    console.log(yellow(`No worktree found for #${number}`));
    return;
  }

  // Validate worktree path and branch
  if (!isValidPath(worktree.path) || !isValidBranchName(worktree.branch)) {
    console.log(red('Invalid worktree path or branch name'));
    return;
  }

  const shouldDelete = await confirmPrompt({
    message: `Remove worktree for #${number} at ${worktree.path}?`,
    defaultValue: false,
  });

  if (!shouldDelete) {
    console.log(gray('Cancelled.'));
    return;
  }

  try {
    const repoPath = getRepoPath(context);
    const result = Bun.spawnSync(['git', 'worktree', 'remove', worktree.path, '--force'], {
      cwd: repoPath,
      stdout: 'pipe', stderr: 'pipe',
    });
    if (result.exitCode === 0) {
      console.log(green(`Removed worktree: ${worktree.path}`));
    } else {
      console.log(red(`Failed to remove worktree: ${worktree.path}`));
      return;
    }

    // Optionally delete the branch
    const deleteBranch = await confirmPrompt({
      message: `Also delete branch ${worktree.branch}?`,
      defaultValue: false,
    });

    if (deleteBranch) {
      const branchResult = Bun.spawnSync(['git', 'branch', '-D', worktree.branch], {
        cwd: repoPath,
        stdout: 'pipe', stderr: 'pipe',
      });
      if (branchResult.exitCode === 0) {
        console.log(green(`Deleted branch: ${worktree.branch}`));
      } else {
        console.log(yellow(`Could not delete branch ${worktree.branch}`));
      }
    }
  } catch (error) {
    console.log(red(`Failed to remove worktree: ${error}`));
  }
}

async function cleanWorktrees(context: CommandContext): Promise<void> {
  const worktrees = getWorktrees(context);

  if (worktrees.length === 0) {
    console.log(yellow('No ghopilot worktrees to clean.'));
    return;
  }

  console.log(yellow(`\nFound ${worktrees.length} ghopilot worktree(s):`));
  for (const wt of worktrees) {
    console.log(gray(`  #${wt.number} - ${wt.path}`));
  }
  console.log();

  const shouldClean = await confirmPrompt({
    message: 'Remove all ghopilot worktrees?',
    defaultValue: false,
  });

  if (!shouldClean) {
    console.log(gray('Cancelled.'));
    return;
  }

  const repoPath = getRepoPath(context);
  
  for (const wt of worktrees) {
    // Validate path before removing
    if (!isValidPath(wt.path)) {
      console.log(yellow(`Skipping invalid path: ${wt.path}`));
      continue;
    }
    
    const result = Bun.spawnSync(['git', 'worktree', 'remove', wt.path, '--force'], {
      cwd: repoPath,
      stdout: 'pipe', stderr: 'pipe',
    });
    if (result.exitCode === 0) {
      console.log(green(`Removed: ${wt.path}`));
    } else {
      console.log(yellow(`Could not remove: ${wt.path}`));
    }
  }

  // Prune worktrees
  Bun.spawnSync(['git', 'worktree', 'prune'], { cwd: repoPath, stdout: 'pipe', stderr: 'pipe' });

  console.log(green('\nWorktree cleanup complete.'));
}






