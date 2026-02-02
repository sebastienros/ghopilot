import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import type { Config, Repository, Note, NoteEntry, FlaggedItem, PinnedItem } from '../types/index.js';

const CONFIG_DIR = path.join(os.homedir(), '.ghopilot');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const NOTES_DIR = path.join(CONFIG_DIR, 'notes');
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
  flagged: [],
  pinned: [],
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

export async function addRepository(
  config: Config, 
  owner: string, 
  repo: string, 
  customPath?: string
): Promise<{ config: Config; cloned: boolean; localPath: string }> {
  // Use custom path if provided, otherwise use default
  const localPath = customPath ? expandPath(customPath) : getRepoLocalPath(config, owner, repo);
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
    // Ensure parent directory exists
    const parentDir = path.dirname(localPath);
    await fs.mkdir(parentDir, { recursive: true });
    
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

export function getRepoNameFromPath(repoPath: string): { owner: string; repo: string } | null {
  try {
    const expandedPath = expandPath(repoPath);
    const remoteUrl = execSync('git remote get-url origin', {
      cwd: expandedPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    
    // Parse GitHub URL formats:
    // https://github.com/owner/repo.git
    // git@github.com:owner/repo.git
    // https://github.com/owner/repo
    const httpsMatch = remoteUrl.match(/github\.com\/([^/]+)\/([^/.]+)/);
    const sshMatch = remoteUrl.match(/github\.com:([^/]+)\/([^/.]+)/);
    
    const match = httpsMatch || sshMatch;
    if (match) {
      return { owner: match[1], repo: match[2] };
    }
    return null;
  } catch {
    return null;
  }
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

// Notes storage functions

function getNoteFilePath(owner: string, repo: string, number: number): string {
  return path.join(NOTES_DIR, owner, repo, `${number}.json`);
}

export async function ensureNotesDir(owner: string, repo: string): Promise<void> {
  const dir = path.join(NOTES_DIR, owner, repo);
  await fs.mkdir(dir, { recursive: true });
}

export async function getNote(owner: string, repo: string, number: number): Promise<Note | null> {
  const filePath = getNoteFilePath(owner, repo, number);
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data) as Note;
  } catch {
    return null;
  }
}

export async function saveNote(note: Note): Promise<void> {
  await ensureNotesDir(note.owner, note.repo);
  const filePath = getNoteFilePath(note.owner, note.repo, note.number);
  note.updatedAt = new Date().toISOString();
  await fs.writeFile(filePath, JSON.stringify(note, null, 2), 'utf-8');
}

export async function createOrUpdateNote(
  owner: string,
  repo: string,
  number: number,
  type: 'issue' | 'pr',
  title: string,
  updates: { summary?: string; review?: string }
): Promise<Note> {
  let note = await getNote(owner, repo, number);
  
  if (!note) {
    note = {
      id: `${owner}/${repo}#${number}`,
      owner,
      repo,
      number,
      type,
      title,
      summary: '',
      discussion: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }
  
  if (updates.summary !== undefined) {
    note.summary = updates.summary;
  }
  if (updates.review !== undefined) {
    note.review = updates.review;
  }
  note.title = title;
  
  await saveNote(note);
  return note;
}

export async function addNoteEntry(
  owner: string,
  repo: string,
  number: number,
  entry: NoteEntry
): Promise<Note | null> {
  const note = await getNote(owner, repo, number);
  if (!note) {
    return null;
  }
  
  note.discussion.push(entry);
  await saveNote(note);
  return note;
}

export async function listNotes(owner: string, repo: string): Promise<Note[]> {
  const dir = path.join(NOTES_DIR, owner, repo);
  try {
    const files = await fs.readdir(dir);
    const notes: Note[] = [];
    
    for (const file of files) {
      if (file.endsWith('.json')) {
        try {
          const data = await fs.readFile(path.join(dir, file), 'utf-8');
          notes.push(JSON.parse(data) as Note);
        } catch {
          // Skip invalid files
        }
      }
    }
    
    return notes.sort((a, b) => 
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  } catch {
    return [];
  }
}

export async function deleteNote(owner: string, repo: string, number: number): Promise<boolean> {
  const filePath = getNoteFilePath(owner, repo, number);
  try {
    await fs.unlink(filePath);
    return true;
  } catch {
    return false;
  }
}

// Flag/favorite functions

export function isFlagged(config: Config, owner: string, repo: string, number: number): boolean {
  return config.flagged?.some(f => f.owner === owner && f.repo === repo && f.number === number) ?? false;
}

export function flagItem(config: Config, owner: string, repo: string, number: number, type: 'issue' | 'pr'): Config {
  if (!config.flagged) {
    config.flagged = [];
  }
  
  if (!isFlagged(config, owner, repo, number)) {
    config.flagged.push({
      owner,
      repo,
      number,
      type,
      flaggedAt: new Date().toISOString(),
    });
  }
  return config;
}

export function unflagItem(config: Config, owner: string, repo: string, number: number): Config {
  if (config.flagged) {
    config.flagged = config.flagged.filter(f => !(f.owner === owner && f.repo === repo && f.number === number));
  }
  return config;
}

export function toggleFlag(config: Config, owner: string, repo: string, number: number, type: 'issue' | 'pr'): { config: Config; flagged: boolean } {
  if (isFlagged(config, owner, repo, number)) {
    unflagItem(config, owner, repo, number);
    return { config, flagged: false };
  } else {
    flagItem(config, owner, repo, number, type);
    return { config, flagged: true };
  }
}

export function getFlaggedItems(config: Config, owner?: string, repo?: string, type?: 'issue' | 'pr'): FlaggedItem[] {
  if (!config.flagged) return [];
  
  return config.flagged.filter(f => {
    if (owner && f.owner !== owner) return false;
    if (repo && f.repo !== repo) return false;
    if (type && f.type !== type) return false;
    return true;
  }).sort((a, b) => new Date(b.flaggedAt).getTime() - new Date(a.flaggedAt).getTime());
}

// Pin functions

export function isPinned(config: Config, owner: string, repo: string, number: number): boolean {
  return config.pinned?.some(p => p.owner === owner && p.repo === repo && p.number === number) ?? false;
}

export function pinItem(config: Config, owner: string, repo: string, number: number, type: 'issue' | 'pr'): Config {
  if (!config.pinned) {
    config.pinned = [];
  }
  
  if (!isPinned(config, owner, repo, number)) {
    config.pinned.push({
      owner,
      repo,
      number,
      type,
      pinnedAt: new Date().toISOString(),
    });
  }
  return config;
}

export function unpinItem(config: Config, owner: string, repo: string, number: number): Config {
  if (config.pinned) {
    config.pinned = config.pinned.filter(p => !(p.owner === owner && p.repo === repo && p.number === number));
  }
  return config;
}

export function togglePin(config: Config, owner: string, repo: string, number: number, type: 'issue' | 'pr'): { config: Config; pinned: boolean } {
  if (isPinned(config, owner, repo, number)) {
    unpinItem(config, owner, repo, number);
    return { config, pinned: false };
  } else {
    pinItem(config, owner, repo, number, type);
    return { config, pinned: true };
  }
}

export function getPinnedItems(config: Config, owner?: string, repo?: string, type?: 'issue' | 'pr'): PinnedItem[] {
  if (!config.pinned) return [];
  
  return config.pinned.filter(p => {
    if (owner && p.owner !== owner) return false;
    if (repo && p.repo !== repo) return false;
    if (type && p.type !== type) return false;
    return true;
  }).sort((a, b) => new Date(a.pinnedAt).getTime() - new Date(b.pinnedAt).getTime());
}
