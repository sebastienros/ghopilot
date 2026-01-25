// Types for ghopilot configuration and state

export interface Repository {
  owner: string;
  repo: string;
  lastUsed?: string;
  localPath?: string;
}

export interface Config {
  repositories: Repository[];
  activeRepository: Repository | null;
  activeIssue: number | null;
  activePR: number | null;
  username: string | null;
  branchPrefix: string | null;
  reposPath: string | null;
}

export interface CommandArg {
  name: string;
  description: string;
  required: boolean;
  choices?: string[];
}

export interface Command {
  name: string;
  aliases?: string[];
  description: string;
  args?: CommandArg[];
  subcommands?: Command[];
  execute: (args: string[], context: CommandContext) => Promise<void>;
}

export interface CommandContext {
  config: Config;
  saveConfig: () => Promise<void>;
  reloadConfig: () => Promise<void>;
  cwd: string;
  setCwd: (path: string) => void;
}

export interface Issue {
  number: number;
  title: string;
  state: string;
  author: string;
  assignees: string[];
  labels: string[];
  createdAt: string;
  url: string;
}

export interface PullRequest {
  number: number;
  title: string;
  state: string;
  author: string;
  reviewers: string[];
  labels: string[];
  createdAt: string;
  url: string;
  headBranch: string;
  baseBranch: string;
  isDraft: boolean;
}

export interface Worktree {
  path: string;
  branch: string;
  number: number;
  type: 'issue' | 'pr';
}
