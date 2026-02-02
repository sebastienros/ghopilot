import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import type { Config, Repository } from '../types/index.js';

const CONFIG_DIR = path.join(os.homedir(), '.ghopilot');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const DEFAULT_REPOS_PATH = path.join(os.homedir(), 'repos');

const DEFAULT_CONFIG: Config = {
  repositories: [],
  activeRepository: null,
  activeIssue: null,
  activePR: null,
  username: null,
  branchPrefix: null,
  reposPath: null,
  defaultModel: null,
};

export async function ensureConfigDir(): Promise<void> {
  try {
    await fs.mkdir(CONFIG_DIR, { recursive: true });
  } catch {
    // Directory already exists
  }
}

export async function loadConfig(): Promise<Config> {
  await ensureConfigDir();
  try {
    const data = await fs.readFile(CONFIG_FILE, 'utf-8');
    const config = JSON.parse(data) as Partial<Config>;
    return { ...DEFAULT_CONFIG, ...config };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export async function saveConfig(config: Config): Promise<void> {
  await ensureConfigDir();
  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

export function expandPath(p: string): string {
  if (p.startsWith('~/')) {
    return path.join(os.homedir(), p.slice(2));
  }
  if (p === '~') {
    return os.homedir();
  }
  return p;
}

export function getReposPath(config: Config): string {
  const reposPath = config.reposPath || DEFAULT_REPOS_PATH;
  return expandPath(reposPath);
}

export function getRepoLocalPath(config: Config, owner: string, repo: string): string {
  return path.join(getReposPath(config), owner, repo);
}

export async function addRepository(config: Config, owner: string, repo: string): Promise<{ config: Config; cloned: boolean; localPath: string }> {
  const localPath = getRepoLocalPath(config, owner, repo);
  let cloned = false;
  
  // Check if already in config
  const existingIdx = config.repositories.findIndex(r => r.owner === owner && r.repo === repo);
  
  // Check if local path exists
  let localExists = false;
  try {
    await fs.access(localPath);
    localExists = true;
  } catch {
    localExists = false;
  }
  
  // Clone if doesn't exist locally
  if (!localExists) {
    const reposPath = getReposPath(config);
    const ownerPath = path.join(reposPath, owner);
    
    // Ensure directories exist
    await fs.mkdir(ownerPath, { recursive: true });
    
    // Clone using gh CLI
    execSync(`gh repo clone ${owner}/${repo} "${localPath}"`, {
      stdio: 'inherit',
    });
    cloned = true;
  }
  
  // Update or add repository in config
  if (existingIdx >= 0) {
    config.repositories[existingIdx].lastUsed = new Date().toISOString();
    config.repositories[existingIdx].localPath = localPath;
  } else {
    config.repositories.push({ 
      owner, 
      repo, 
      lastUsed: new Date().toISOString(),
      localPath,
    });
  }
  
  return { config, cloned, localPath };
}

export async function removeRepository(config: Config, owner: string, repo: string): Promise<Config> {
  config.repositories = config.repositories.filter(r => !(r.owner === owner && r.repo === repo));
  if (config.activeRepository?.owner === owner && config.activeRepository?.repo === repo) {
    config.activeRepository = null;
  }
  return config;
}

export function selectRepository(config: Config, owner: string, repo: string): Config {
  const repository = config.repositories.find(r => r.owner === owner && r.repo === repo);
  if (repository) {
    repository.lastUsed = new Date().toISOString();
    config.activeRepository = { owner, repo };
    config.activeIssue = null;
    config.activePR = null;
  }
  return config;
}

export function getRecentRepositories(config: Config): Repository[] {
  return [...config.repositories].sort((a, b) => {
    const aTime = a.lastUsed ? new Date(a.lastUsed).getTime() : 0;
    const bTime = b.lastUsed ? new Date(b.lastUsed).getTime() : 0;
    return bTime - aTime;
  });
}

export function formatRepoName(repo: Repository): string {
  return `${repo.owner}/${repo.repo}`;
}

export function parseRepoName(name: string): { owner: string; repo: string } | null {
  const parts = name.split('/');
  if (parts.length !== 2) return null;
  return { owner: parts[0], repo: parts[1] };
}

export function formatBranchName(prefix: string, number: number): string {
  // If prefix is empty, just use the number
  if (!prefix) {
    return `ghopilot-${number}`;
  }
  
  // If prefix ends with / or other non-alphanumeric, don't add separator
  const lastChar = prefix.slice(-1);
  if (!/[a-zA-Z0-9]/.test(lastChar)) {
    return `${prefix}${number}`;
  }
  
  // Otherwise add / separator
  return `${prefix}/${number}`;
}
