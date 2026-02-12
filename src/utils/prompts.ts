import { join } from 'path';
import { homedir } from 'os';
import type { Config, Repository, Issue, PullRequest } from '../types/index.ts';

const PROMPTS_DIR = join(homedir(), '.ghopilot', 'prompts');

export interface PromptTemplate {
  name: string;
  description: string;
  content: string;
}

export interface PromptContext {
  issue_number?: number;
  issue_title?: string;
  issue_body?: string;
  pr_number?: number;
  pr_title?: string;
  pr_body?: string;
  repo?: string;
  branch?: string;
  username?: string;
  prefix?: string;
  worktree_path?: string;
}

// Default prompts stored in code
const DEFAULT_PROMPTS: Record<string, PromptTemplate> = {
  fix: {
    name: 'fix',
    description: 'Prompt for fixing an issue',
    content: `Fix issue #{{issue_number}} in {{repo}}.

**Issue:** {{issue_title}}

{{issue_body}}

You MUST implement the fix by editing the necessary files. Do not just describe the changes - actually make them.

1. First, explore the codebase to understand the relevant code
2. Then edit the files to implement the fix
3. Follow the existing code style and conventions
4. Handle edge cases and add appropriate error handling

Make the minimal, targeted changes needed to fix the issue.`,
  },

  plan: {
    name: 'plan',
    description: 'Prompt for planning the implementation',
    content: `Create an implementation plan for issue #{{issue_number}} in {{repo}}.

**Issue:** {{issue_title}}

{{issue_body}}

Provide a detailed plan including:
1. Analysis of what needs to be changed
2. Files that will be modified or created
3. Step-by-step implementation approach
4. Potential risks or edge cases to consider
5. Testing strategy`,
  },

  review: {
    name: 'review',
    description: 'Prompt for reviewing code changes',
    content: `Review the code changes in this branch for {{repo}}.

{{#if pr_number}}
**PR #{{pr_number}}:** {{pr_title}}
{{/if}}

{{#if issue_number}}
**Related Issue #{{issue_number}}:** {{issue_title}}
{{/if}}

Perform a thorough code review focusing on:
1. Correctness - Does the code do what it's supposed to?
2. Security - Are there any security vulnerabilities?
3. Performance - Are there any performance concerns?
4. Maintainability - Is the code clean and well-structured?
5. Edge cases - Are all edge cases handled?

Provide specific, actionable feedback with file and line references.`,
  },

  'fix-review': {
    name: 'fix-review',
    description: 'Prompt for fixing issues from code review',
    content: `Fix the issues identified in the code review for {{repo}}.

{{#if pr_number}}
**PR #{{pr_number}}:** {{pr_title}}
{{/if}}

{{#if issue_number}}
**Related Issue #{{issue_number}}:** {{issue_title}}
{{/if}}

Review the code changes in this branch and fix any issues related to:
1. Correctness - Fix any bugs or logic errors
2. Security - Address any security vulnerabilities
3. Performance - Optimize any performance issues
4. Maintainability - Improve code structure and clarity
5. Edge cases - Handle any missing edge cases

Make the necessary changes to the files. Do not just describe the fixes - actually edit the files.`,
  },

  test: {
    name: 'test',
    description: 'Prompt for generating tests',
    content: `Create and save comprehensive test files for the changes in {{repo}}.

{{#if worktree_path}}
**Worktree:** {{worktree_path}}
{{/if}}

{{#if pr_number}}
**PR #{{pr_number}}:** {{pr_title}}
{{/if}}

{{#if issue_number}}
**Related Issue #{{issue_number}}:** {{issue_title}}
{{/if}}

Analyze the changes and create test files that cover:
1. Happy path scenarios
2. Edge cases and boundary conditions
3. Error handling and failure modes
4. Integration with existing code

Follow the existing test patterns and frameworks used in the repository.
Write the test files to disk - do not just describe them.`,
  },

  verify: {
    name: 'verify',
    description: 'Prompt for verification scenarios',
    content: `Verify the implementation for {{repo}} works correctly.

{{#if pr_number}}
**PR #{{pr_number}}:** {{pr_title}}
{{/if}}

{{#if issue_number}}
**Issue #{{issue_number}}:** {{issue_title}}
{{/if}}

Create and execute verification scenarios to ensure:
1. The original issue is resolved
2. No regressions were introduced
3. The feature works as expected in different scenarios
4. Error cases are handled gracefully

Document the verification results and any issues found.`,
  },

  'pr-title': {
    name: 'pr-title',
    description: 'Prompt for generating PR title',
    content: `Generate a concise PR title for the changes in branch {{branch}}.

{{#if issue_number}}
Fixes issue #{{issue_number}}: {{issue_title}}
{{/if}}

Follow conventional commits format (feat:, fix:, docs:, refactor:, etc.)
Keep the title under 72 characters.
Be specific about what the change does.`,
  },

  'pr-description': {
    name: 'pr-description',
    description: 'Prompt for generating PR description',
    content: `Generate a PR description for the changes in branch {{branch}} for {{repo}}.

{{#if issue_number}}
**Fixes:** #{{issue_number}}
**Issue Title:** {{issue_title}}

{{issue_body}}
{{/if}}

Include:
1. Summary of changes
2. Motivation and context
3. How the changes were tested
4. Screenshots (if applicable)
5. Checklist of completed items

Use markdown formatting.`,
  },

  'explain-issue': {
    name: 'explain-issue',
    description: 'Prompt for explaining/summarizing an issue',
    content: `Summarize and explain issue #{{issue_number}} in {{repo}}.

**Issue Title:** {{issue_title}}

{{issue_body}}

Provide a clear, concise explanation that includes:
1. What is the problem or request?
2. Why does it matter? What's the impact?
3. What are the key technical details?
4. What would a solution likely involve?
5. Any potential challenges or considerations?

Keep the explanation accessible but technically accurate.`,
  },

  'explain-pr': {
    name: 'explain-pr',
    description: 'Prompt for explaining/summarizing PR changes',
    content: `Summarize and explain Pull Request #{{pr_number}} in {{repo}}.

**PR Title:** {{pr_title}}

{{pr_body}}

{{#if issue_number}}
**Related Issue #{{issue_number}}:** {{issue_title}}
{{/if}}

Analyze the PR changes and provide:
1. What does this PR do? (high-level summary)
2. What files/components are affected?
3. What's the approach taken?
4. Are there any notable implementation details?
5. What should reviewers pay attention to?

Focus on helping someone quickly understand the changes.`,
  },
};

export async function ensurePromptsDir(): Promise<void> {
  const { mkdir } = await import('fs/promises');
  await mkdir(PROMPTS_DIR, { recursive: true });
}

export function getDefaultPrompt(name: string): PromptTemplate | undefined {
  return DEFAULT_PROMPTS[name];
}

export function getAllDefaultPrompts(): PromptTemplate[] {
  return Object.values(DEFAULT_PROMPTS);
}

export async function getUserPrompt(name: string): Promise<string | null> {
  try {
    const filePath = join(PROMPTS_DIR, `${name}.md`);
    return await Bun.file(filePath).text();
  } catch {
    return null;
  }
}

export async function getPrompt(name: string): Promise<PromptTemplate | null> {
  const defaultPrompt = getDefaultPrompt(name);
  if (!defaultPrompt) {
    return null;
  }

  const userContent = await getUserPrompt(name);
  if (userContent) {
    return {
      ...defaultPrompt,
      content: userContent,
    };
  }

  return defaultPrompt;
}

export async function saveUserPrompt(name: string, content: string): Promise<void> {
  await ensurePromptsDir();
  const filePath = join(PROMPTS_DIR, `${name}.md`);
  await Bun.write(filePath, content);
}

export async function deleteUserPrompt(name: string): Promise<boolean> {
  try {
    const { unlink } = await import('fs/promises');
    const filePath = join(PROMPTS_DIR, `${name}.md`);
    await unlink(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function isPromptCustomized(name: string): Promise<boolean> {
  const userContent = await getUserPrompt(name);
  return userContent !== null;
}

export async function resetAllPrompts(): Promise<number> {
  let count = 0;
  for (const name of Object.keys(DEFAULT_PROMPTS)) {
    if (await deleteUserPrompt(name)) {
      count++;
    }
  }
  return count;
}

export function renderPrompt(template: string, context: PromptContext): string {
  let result = template;

  // Replace simple variables
  for (const [key, value] of Object.entries(context)) {
    if (value !== undefined && value !== null) {
      const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
      result = result.replace(regex, String(value));
    }
  }

  // Handle conditional blocks {{#if variable}}...{{/if}}
  result = result.replace(/\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (match, variable, content) => {
    const value = context[variable as keyof PromptContext];
    if (value !== undefined && value !== null && value !== '') {
      return content;
    }
    return '';
  });

  // Clean up any remaining unresolved variables
  result = result.replace(/\{\{\w+\}\}/g, '');

  // Clean up extra blank lines
  result = result.replace(/\n{3,}/g, '\n\n');

  return result.trim();
}

export function getPromptsDir(): string {
  return PROMPTS_DIR;
}

export function buildPromptContext(
  config: Config,
  options: {
    issue?: Issue;
    pr?: PullRequest;
    branch?: string;
    worktree_path?: string;
  } = {}
): PromptContext {
  const repo = config.activeRepository;
  
  return {
    issue_number: options.issue?.number ?? config.activeIssue ?? undefined,
    issue_title: options.issue?.title,
    issue_body: '', // Would need to fetch from GitHub
    pr_number: options.pr?.number ?? config.activePR ?? undefined,
    pr_title: options.pr?.title,
    pr_body: '', // Would need to fetch from GitHub
    repo: repo ? `${repo.owner}/${repo.repo}` : undefined,
    branch: options.branch,
    username: config.username ?? undefined,
    prefix: config.branchPrefix ?? undefined,
    worktree_path: options.worktree_path,
  };
}
