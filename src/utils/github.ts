import { execSync, spawn } from 'child_process';
import type { Issue, PullRequest, Repository } from '../types/index.js';

export function isGhInstalled(): boolean {
  try {
    execSync('gh --version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

export function isGhAuthenticated(): boolean {
  try {
    execSync('gh auth status', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

export function getGitRepoFromCwd(): { owner: string; repo: string } | null {
  try {
    // Get the remote URL from git
    const remoteUrl = execSync('git remote get-url origin', { stdio: 'pipe', encoding: 'utf-8' }).trim();
    
    // Parse GitHub URL formats:
    // https://github.com/owner/repo.git
    // git@github.com:owner/repo.git
    // https://github.com/owner/repo
    
    let match = remoteUrl.match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(\.git)?$/);
    if (match) {
      return { owner: match[1], repo: match[2] };
    }
    
    return null;
  } catch {
    return null;
  }
}

export async function runGh(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('gh', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(stderr || `gh exited with code ${code}`));
      }
    });
  });
}

export async function listIssues(repo: Repository, assignee?: string): Promise<Issue[]> {
  const args = ['issue', 'list', '-R', `${repo.owner}/${repo.repo}`, '--json', 'number,title,state,author,assignees,labels,createdAt,url'];
  if (assignee) {
    args.push('--assignee', assignee);
  }
  const output = await runGh(args);
  if (!output) return [];
  const issues = JSON.parse(output);
  return issues.map((i: any) => ({
    number: i.number,
    title: i.title,
    state: i.state,
    author: i.author?.login || '',
    assignees: i.assignees?.map((a: any) => a.login) || [],
    labels: i.labels?.map((l: any) => l.name) || [],
    createdAt: i.createdAt,
    url: i.url,
  }));
}

export async function getIssue(repo: Repository, number: number): Promise<Issue | null> {
  try {
    const args = ['issue', 'view', String(number), '-R', `${repo.owner}/${repo.repo}`, '--json', 'number,title,state,author,assignees,labels,createdAt,url'];
    const output = await runGh(args);
    const i = JSON.parse(output);
    return {
      number: i.number,
      title: i.title,
      state: i.state,
      author: i.author?.login || '',
      assignees: i.assignees?.map((a: any) => a.login) || [],
      labels: i.labels?.map((l: any) => l.name) || [],
      createdAt: i.createdAt,
      url: i.url,
    };
  } catch {
    return null;
  }
}

export async function listPullRequests(repo: Repository, options?: { author?: string; reviewer?: string }): Promise<PullRequest[]> {
  const args = ['pr', 'list', '-R', `${repo.owner}/${repo.repo}`, '--json', 'number,title,state,author,reviewRequests,labels,createdAt,url,headRefName,baseRefName,isDraft'];
  if (options?.author) {
    args.push('--author', options.author);
  }
  // Note: gh doesn't have --reviewer flag, we filter client-side
  const output = await runGh(args);
  if (!output) return [];
  let prs = JSON.parse(output);
  
  if (options?.reviewer) {
    prs = prs.filter((p: any) => 
      p.reviewRequests?.some((r: any) => r.login === options.reviewer)
    );
  }

  return prs.map((p: any) => ({
    number: p.number,
    title: p.title,
    state: p.state,
    author: p.author?.login || '',
    reviewers: p.reviewRequests?.map((r: any) => r.login) || [],
    labels: p.labels?.map((l: any) => l.name) || [],
    createdAt: p.createdAt,
    url: p.url,
    headBranch: p.headRefName,
    baseBranch: p.baseRefName,
    isDraft: p.isDraft,
  }));
}

export async function getPullRequest(repo: Repository, number: number): Promise<PullRequest | null> {
  try {
    const args = ['pr', 'view', String(number), '-R', `${repo.owner}/${repo.repo}`, '--json', 'number,title,state,author,reviewRequests,labels,createdAt,url,headRefName,baseRefName,isDraft'];
    const output = await runGh(args);
    const p = JSON.parse(output);
    return {
      number: p.number,
      title: p.title,
      state: p.state,
      author: p.author?.login || '',
      reviewers: p.reviewRequests?.map((r: any) => r.login) || [],
      labels: p.labels?.map((l: any) => l.name) || [],
      createdAt: p.createdAt,
      url: p.url,
      headBranch: p.headRefName,
      baseBranch: p.baseRefName,
      isDraft: p.isDraft,
    };
  } catch {
    return null;
  }
}

export async function checkoutPR(number: number, cwd: string): Promise<void> {
  await runGh(['pr', 'checkout', String(number)]);
}

export async function createPR(title: string, body: string, base?: string): Promise<string> {
  const args = ['pr', 'create', '--title', title, '--body', body];
  if (base) {
    args.push('--base', base);
  }
  return await runGh(args);
}

export async function getAuthenticatedUser(): Promise<string | null> {
  try {
    const output = await runGh(['api', 'user', '--jq', '.login']);
    return output || null;
  } catch {
    return null;
  }
}
