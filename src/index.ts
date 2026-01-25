#!/usr/bin/env node

import chalk from 'chalk';
import * as os from 'os';
import * as path from 'path';
import { select, input } from '@inquirer/prompts';
import { displayLogo } from './utils/logo.js';
import { loadConfig, saveConfig, getRecentRepositories, formatRepoName, parseRepoName, selectRepository, addRepository, getReposPath } from './utils/config.js';
import { isGhInstalled, isGhAuthenticated, getGitRepoFromCwd } from './utils/github.js';
import { startRepl } from './repl.js';

async function ensureSettings(config: Awaited<ReturnType<typeof loadConfig>>): Promise<void> {
  let needsSave = false;
  
  // Check if this is first run (no settings configured)
  const isFirstRun = !config.reposPath && !config.username && config.branchPrefix === null;
  
  if (isFirstRun) {
    console.log(chalk.cyan('\n📋 Let\'s configure ghopilot:\n'));
  }
  
  // GitHub username (for 'me' shortcut)
  if (!config.username) {
    // Try to get from gh CLI
    let defaultUsername: string | undefined;
    try {
      const { execSync } = await import('child_process');
      defaultUsername = execSync('gh api user --jq .login', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    } catch {
      // Ignore
    }
    
    const username = await input({
      message: 'Your GitHub username (for "me" shortcut):',
      default: defaultUsername,
    });
    config.username = username || null;
    needsSave = true;
  }
  
  // Repositories path
  if (!config.reposPath) {
    const defaultPath = path.join(os.homedir(), 'repos');
    const reposPath = await input({
      message: 'Where should repositories be cloned?',
      default: defaultPath,
    });
    config.reposPath = reposPath;
    needsSave = true;
  }
  
  // Branch prefix (can be empty, but should be explicitly set)
  if (config.branchPrefix === null) {
    const prefix = await input({
      message: 'Branch prefix for worktrees (leave empty for none):',
      default: config.username || '',
    });
    config.branchPrefix = prefix || '';
    needsSave = true;
  }
  
  if (needsSave) {
    await saveConfig(config);
    if (isFirstRun) {
      console.log(chalk.green('\n✓ Settings saved!\n'));
    }
  }
}

async function addAndSelectRepo(config: Awaited<ReturnType<typeof loadConfig>>, repoName: string): Promise<boolean> {
  const parsed = parseRepoName(repoName);
  if (!parsed) {
    console.log(chalk.red('Invalid repository format. Use owner/repo'));
    return false;
  }

  console.log(chalk.gray(`Cloning ${repoName}...`));
  
  try {
    const result = await addRepository(config, parsed.owner, parsed.repo);
    selectRepository(config, parsed.owner, parsed.repo);
    await saveConfig(config);
    
    if (result.cloned) {
      console.log(chalk.green(`✓ Cloned ${repoName} to ${result.localPath}\n`));
    } else {
      console.log(chalk.green(`✓ Selected ${repoName} (${result.localPath})\n`));
    }
    return true;
  } catch (error) {
    if (error instanceof Error) {
      console.log(chalk.red(`Failed to clone repository: ${error.message}`));
    }
    return false;
  }
}

async function main(): Promise<void> {
  // Display animated logo
  await displayLogo();

  // Check for gh CLI
  if (!isGhInstalled()) {
    console.log(chalk.red('Error: GitHub CLI (gh) is not installed.'));
    console.log(chalk.gray('Please install it from: https://cli.github.com/'));
    process.exit(1);
  }

  if (!isGhAuthenticated()) {
    console.log(chalk.red('Error: GitHub CLI is not authenticated.'));
    console.log(chalk.gray('Please run: gh auth login'));
    process.exit(1);
  }

  // Load config
  let config = await loadConfig();

  // Ensure required settings are configured
  await ensureSettings(config);
  
  // Reload config after settings
  config = await loadConfig();

  // Parse CLI arguments
  const args = process.argv.slice(2);
  let selectedRepo: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--repo' || args[i] === '-r') {
      selectedRepo = args[i + 1];
      i++;
    }
  }

  // Check if running from a git repository
  const cwdRepo = getGitRepoFromCwd();

  // If repo provided via argument, select it
  if (selectedRepo) {
    const success = await addAndSelectRepo(config, selectedRepo);
    if (!success) {
      process.exit(1);
    }
  } else if (cwdRepo) {
    // Running from a git repository - use it
    const repoName = `${cwdRepo.owner}/${cwdRepo.repo}`;
    console.log(chalk.gray(`Detected repository: ${repoName}\n`));
    
    // Check if already in config
    const exists = config.repositories.some(
      r => r.owner === cwdRepo.owner && r.repo === cwdRepo.repo
    );
    
    if (!exists) {
      // Add to config with current path as localPath
      config.repositories.push({
        owner: cwdRepo.owner,
        repo: cwdRepo.repo,
        lastUsed: new Date().toISOString(),
        localPath: process.cwd(),
      });
    }
    
    selectRepository(config, cwdRepo.owner, cwdRepo.repo);
    
    // Update localPath if not set
    const repoConfig = config.repositories.find(
      r => r.owner === cwdRepo.owner && r.repo === cwdRepo.repo
    );
    if (repoConfig && !repoConfig.localPath) {
      repoConfig.localPath = process.cwd();
    }
    
    await saveConfig(config);
    console.log(chalk.green(`Selected: ${repoName}\n`));
  } else {
    // Prompt to select repository
    const repos = getRecentRepositories(config);
    
    if (repos.length > 0) {
      const choices = [
        ...repos.map((r, i) => ({
          name: `${i < 9 ? `${i + 1}. ` : '   '}${formatRepoName(r)}`,
          value: formatRepoName(r),
        })),
        { name: chalk.gray('+ Add a new repository'), value: '__add__' },
      ];

      const selected = await select({
        message: 'Select a repository to work with:',
        choices,
      });

      if (selected === '__add__') {
        const newRepo = await input({
          message: 'Enter repository (owner/repo):',
        });
        
        const success = await addAndSelectRepo(config, newRepo);
        if (!success) {
          process.exit(1);
        }
      } else {
        const parsed = parseRepoName(selected);
        if (parsed) {
          selectRepository(config, parsed.owner, parsed.repo);
          await saveConfig(config);
          console.log(chalk.green(`Selected: ${selected}\n`));
        }
      }
    } else {
      // No repos configured, prompt to add one
      console.log(chalk.yellow('No repositories configured yet.\n'));
      
      const newRepo = await input({
        message: 'Enter a repository to get started (owner/repo):',
      });
      
      const success = await addAndSelectRepo(config, newRepo);
      if (!success) {
        process.exit(1);
      }
    }

    // Reload config after modifications
    config = await loadConfig();
  }

  // Start REPL
  await startRepl(config);
}

main().catch((error) => {
  console.error(chalk.red('Fatal error:'), error.message);
  process.exit(1);
});
