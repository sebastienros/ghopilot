import type { Issue, PullRequest, Repository } from '../types/index.ts';

export function isGhInstalled(): boolean {
  const proc = Bun.spawnSync(['gh', '--version'], { stdout: 'pipe', stderr: 'pipe' });
  return proc.exitCode === 0;
}

export function isGhAuthenticated(): boolean {
  const proc = Bun.spawnSync(['gh', 'auth', 'status'], { stdout: 'pipe', stderr: 'pipe' });
  return proc.exitCode === 0;
}

export function getGitRepoFromCwd(): { owner: string; repo: string } | null {
  try {
    const proc = Bun.spawnSync(['git', 'remote', 'get-url', 'origin'], { stdout: 'pipe', stderr: 'pipe' });
    const remoteUrl = (proc.stdout?.toString() || '').trim();
    
    let match = remoteUrl.match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(\.git)?$/);
    if (match) {
      return { owner: match[1], repo: match[2] };
    }
    
    return null;
  } catch {
    return null;
  }
}

export async function runGh(args: string[], options?: { cwd?: string }): Promise<string> {
  const proc = Bun.spawn(['gh', ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
    cwd: options?.cwd,
  });
  
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  
  if (exitCode === 0) {
    return stdout.trim();
  } else {
    throw new Error(stderr || `gh exited with code ${exitCode}`);
  }
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
  await runGh(['pr', 'checkout', String(number)], { cwd });
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
