import chalk from 'chalk';
import { spawnSync } from 'child_process';
import type { Command, CommandContext } from '../types/index.js';
import { createWorktree, checkAndSwitchWorktree } from './worktrees.js';
import { getIssue, getPullRequest, checkoutPR } from '../utils/github.js';
import { streamToConsole, runWithNewSession } from '../utils/copilot.js';
import { getPrompt, renderPrompt, buildPromptContext } from '../utils/prompts.js';
import { getRepoLocalPath, formatBranchName, createOrUpdateNote } from '../utils/config.js';
import { confirm } from '@inquirer/prompts';

// Validate branch name to prevent command injection
function isValidBranchName(name: string): boolean {
  // Git branch names: alphanumeric, dash, underscore, slash, dot (no spaces or shell metacharacters)
  return /^[a-zA-Z0-9._\/-]+$/.test(name);
}

function getRepoCwd(context: CommandContext): string | undefined {
  // Use context.cwd if we're in a worktree (cwd is set when selecting/creating worktrees)
  // This ensures AI commands operate on the worktree, not the main repo
  if (context.config.activeIssue || context.config.activePR) {
    return context.cwd;
  }
  if (context.config.activeRepository) {
    return getRepoLocalPath(
      context.config, 
      context.config.activeRepository.owner, 
      context.config.activeRepository.repo
    );
  }
  return undefined;
}

export const fixCommand: Command = {
  name: 'fix',
  description: 'Fix an issue using Copilot AI',
  args: [
    { name: 'number', description: 'Issue number (or use selected)', required: false },
  ],
  async execute(args: string[], context: CommandContext) {
    if (!context.config.activeRepository) {
      console.log(chalk.yellow('No repository selected. Use /repo select first.'));
      return;
    }

    const [numberStr] = args;
    let number: number;
    
    if (numberStr) {
      number = parseInt(numberStr, 10);
      if (isNaN(number)) {
        console.log(chalk.red('Invalid issue number'));
        return;
      }
    } else if (context.config.activeIssue) {
      number = context.config.activeIssue;
    } else {
      console.log(chalk.yellow('No issue specified. Use /fix <number> or select an issue with /issue first.'));
      return;
    }

    const repo = context.config.activeRepository;
    const prefix = context.config.branchPrefix || context.config.username || 'ghopilot';
    const branchName = formatBranchName(prefix, number);

    console.log(chalk.cyan(`\nFixing issue #${number}...\n`));

    // Get issue details
    const issue = await getIssue(repo, number);
    if (!issue) {
      console.log(chalk.red(`Issue #${number} not found`));
      return;
    }

    console.log(chalk.bold(issue.title));
    console.log();

    // Create worktree
    try {
      const worktreePath = await createWorktree(number, branchName, context);
      context.setCwd(worktreePath);
      context.config.activeIssue = number;
      context.config.activePR = null;
      await context.saveConfig();

      // First, create a plan
      console.log(chalk.cyan('\n📋 Creating implementation plan...\n'));
      
      const planPrompt = await getPrompt('plan');
      if (planPrompt) {
        const promptContext = buildPromptContext(context.config, { issue, branch: branchName });
        const renderedPrompt = renderPrompt(planPrompt.content, promptContext);
        
        await streamToConsole(renderedPrompt, { model: context.config.defaultModel || undefined, showThinking: true, cwd: getRepoCwd(context), freshSession: true });
      }

      console.log();
      const shouldProceed = await confirm({
        message: 'Proceed with implementation?',
        default: true,
      });

      if (!shouldProceed) {
        console.log(chalk.gray('Implementation cancelled. Worktree is ready for manual work.'));
        return;
      }

      // Implement the fix using Copilot SDK (agentic mode)
      console.log(chalk.cyan('\n🔧 Implementing fix...\n'));
      
      const fixPrompt = await getPrompt('fix');
      if (fixPrompt) {
        const promptContext = buildPromptContext(context.config, { issue, branch: branchName });
        const renderedPrompt = renderPrompt(fixPrompt.content, promptContext);
        
        // Use worktree path for agentic file editing
        await streamToConsole(renderedPrompt, { model: context.config.defaultModel || undefined, showThinking: true, cwd: worktreePath });
      }

      console.log();
      console.log(chalk.green('✓ Implementation complete.'));
      console.log(chalk.gray('Use /review to review the changes, /test to generate tests, or /submit to create a PR.'));
      console.log();

    } catch (error) {
      if (error instanceof Error) {
        console.log(chalk.red(`Error: ${error.message}`));
      }
    }
  },
};

export const reviewCommand: Command = {
  name: 'review',
  description: 'Review current implementation or active PR',
  args: [
    { name: '--model', description: 'Model to use for review', required: false },
  ],
  async execute(args: string[], context: CommandContext) {
    if (!context.config.activeRepository) {
      console.log(chalk.yellow('No repository selected. Use /repo select first.'));
      return;
    }

    const repo = context.config.activeRepository;
    const number = context.config.activePR || context.config.activeIssue;
    if (!number) {
      console.log(chalk.yellow('No issue or PR selected. Use /issue or /pr to select one.'));
      return;
    }

    // Parse model option, fall back to config default
    let model: string | undefined = context.config.defaultModel || undefined;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--model' && args[i + 1]) {
        model = args[i + 1];
        break;
      }
    }

    console.log(chalk.cyan(`\n🔍 Reviewing #${number}...\n`));

    // If it's a PR, checkout first
    if (context.config.activePR) {
      console.log(chalk.gray('Checking out PR...'));
      try {
        await checkoutPR(number, context.cwd);
      } catch (error) {
        if (error instanceof Error) {
          console.log(chalk.red(`Error checking out PR: ${error.message}`));
          return;
        }
      }
    }

    const reviewPrompt = await getPrompt('review');
    if (reviewPrompt) {
      const issue = context.config.activeIssue ? await getIssue(repo, context.config.activeIssue) : undefined;
      const pr = context.config.activePR ? await getPullRequest(repo, context.config.activePR) : undefined;
      
      const promptContext = buildPromptContext(context.config, { issue: issue ?? undefined, pr: pr ?? undefined });
      const renderedPrompt = renderPrompt(reviewPrompt.content, promptContext);
      
      // Capture the review output
      let reviewOutput = '';
      const originalWrite = process.stdout.write.bind(process.stdout);
      process.stdout.write = (chunk: any) => {
        if (typeof chunk === 'string') {
          reviewOutput += chunk;
        }
        return originalWrite(chunk);
      };
      
      // Use different model for review if specified
      await streamToConsole(renderedPrompt, { model, showThinking: true, cwd: getRepoCwd(context) });
      
      process.stdout.write = originalWrite;
      
      // Save review to notes
      const type = context.config.activePR ? 'pr' : 'issue';
      const title = pr?.title || issue?.title || `#${number}`;
      await createOrUpdateNote(repo.owner, repo.repo, number, type, title, { review: reviewOutput.trim() });
      console.log(chalk.gray('\n✓ Review saved to notes. Use /note to view or continue discussion.'));
    }

    console.log();

    // Ask if user wants to fix the issues
    const shouldFix = await confirm({
      message: 'Fix the issues found in the review?',
      default: false,
    });

    if (shouldFix) {
      console.log(chalk.cyan('\n🔧 Fixing review issues...\n'));
      
      const fixReviewPrompt = await getPrompt('fix-review');
      if (fixReviewPrompt) {
        const issue = context.config.activeIssue ? await getIssue(context.config.activeRepository!, context.config.activeIssue) : undefined;
        const pr = context.config.activePR ? await getPullRequest(context.config.activeRepository!, context.config.activePR) : undefined;
        
        const promptContext = buildPromptContext(context.config, { issue: issue ?? undefined, pr: pr ?? undefined });
        const renderedPrompt = renderPrompt(fixReviewPrompt.content, promptContext);
        
        await streamToConsole(renderedPrompt, { model, showThinking: true, cwd: getRepoCwd(context) });
      }
      
      console.log();
      console.log(chalk.green('✓ Review fixes applied.'));
      console.log(chalk.gray('Use /review again to verify, or /submit to create a PR.'));
    }

    console.log();
  },
};

export const testCommand: Command = {
  name: 'test',
  description: 'Create tests for implementation or active PR',
  async execute(_args: string[], context: CommandContext) {
    if (!context.config.activeRepository) {
      console.log(chalk.yellow('No repository selected. Use /repo select first.'));
      return;
    }

    const number = context.config.activePR || context.config.activeIssue;
    if (!number) {
      console.log(chalk.yellow('No issue or PR selected. Use /issue or /pr to select one.'));
      return;
    }

    console.log(chalk.cyan(`\n🧪 Generating tests for #${number}...\n`));

    const testPrompt = await getPrompt('test');
    if (testPrompt) {
      const issue = context.config.activeIssue ? await getIssue(context.config.activeRepository, context.config.activeIssue) : undefined;
      const pr = context.config.activePR ? await getPullRequest(context.config.activeRepository, context.config.activePR) : undefined;
      const worktreePath = getRepoCwd(context);
      
      const promptContext = buildPromptContext(context.config, { issue: issue ?? undefined, pr: pr ?? undefined, worktree_path: worktreePath });
      const renderedPrompt = renderPrompt(testPrompt.content, promptContext);
      
      await streamToConsole(renderedPrompt, { model: context.config.defaultModel || undefined, showThinking: true, cwd: worktreePath });
    }

    console.log();
  },
};

export const verifyCommand: Command = {
  name: 'verify',
  description: 'Verify implementation with user scenarios',
  async execute(_args: string[], context: CommandContext) {
    if (!context.config.activeRepository) {
      console.log(chalk.yellow('No repository selected. Use /repo select first.'));
      return;
    }

    const number = context.config.activePR || context.config.activeIssue;
    if (!number) {
      console.log(chalk.yellow('No issue or PR selected. Use /issue or /pr to select one.'));
      return;
    }

    console.log(chalk.cyan(`\n✅ Verifying #${number}...\n`));

    const verifyPrompt = await getPrompt('verify');
    if (verifyPrompt) {
      const issue = context.config.activeIssue ? await getIssue(context.config.activeRepository, context.config.activeIssue) : undefined;
      const pr = context.config.activePR ? await getPullRequest(context.config.activeRepository, context.config.activePR) : undefined;
      
      const promptContext = buildPromptContext(context.config, { issue: issue ?? undefined, pr: pr ?? undefined });
      const renderedPrompt = renderPrompt(verifyPrompt.content, promptContext);
      
      await streamToConsole(renderedPrompt, { model: context.config.defaultModel || undefined, showThinking: true, cwd: getRepoCwd(context) });
    }

    console.log();
  },
};

export const checkoutCommand: Command = {
  name: 'checkout',
  description: 'Checkout the active PR locally',
  async execute(_args: string[], context: CommandContext) {
    if (!context.config.activeRepository) {
      console.log(chalk.yellow('No repository selected. Use /repo select first.'));
      return;
    }

    if (!context.config.activePR) {
      console.log(chalk.yellow('No PR selected. Use /pr <number> to select one.'));
      return;
    }

    const number = context.config.activePR;
    console.log(chalk.cyan(`\nChecking out PR #${number}...\n`));

    try {
      await checkoutPR(number, context.cwd);
      await checkAndSwitchWorktree(number, context);
      console.log(chalk.green(`Checked out PR #${number}`));
    } catch (error) {
      if (error instanceof Error) {
        console.log(chalk.red(`Error: ${error.message}`));
      }
    }
  },
};

export const submitPrCommand: Command = {
  name: 'submit',
  description: 'Submit a PR for the current work',
  async execute(_args: string[], context: CommandContext) {
    if (!context.config.activeRepository) {
      console.log(chalk.yellow('No repository selected. Use /repo select first.'));
      return;
    }

    if (!context.config.activeIssue) {
      console.log(chalk.yellow('No issue selected. Use /fix <number> to start working on an issue.'));
      return;
    }

    const number = context.config.activeIssue;
    const issue = await getIssue(context.config.activeRepository, number);
    // Use context.cwd which should be the worktree path, not the main repo
    const repoCwd = context.cwd;
    
    // Verify we're in a worktree, not the main repo
    try {
      const result = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
        cwd: repoCwd,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
      const currentBranch = (result.stdout || '').trim();
      
      if (currentBranch === 'main' || currentBranch === 'master') {
        console.log(chalk.yellow('You are on the main branch, not a worktree.'));
        console.log(chalk.gray('Use /fix to create a worktree and start working on the issue.'));
        return;
      }
      
      console.log(chalk.gray(`Branch: ${currentBranch}\n`));
    } catch {
      // Continue
    }
    
    // Check for uncommitted changes and commit them
    try {
      const statusResult = spawnSync('git', ['status', '--porcelain'], {
        cwd: repoCwd,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
      const status = (statusResult.stdout || '').trim();
      
      if (status) {
        console.log(chalk.cyan('📦 Uncommitted changes detected. Committing...\n'));
        
        // Stage all changes
        spawnSync('git', ['add', '-A'], { cwd: repoCwd, stdio: 'pipe' });
        
        // Generate commit message (safe - passed as array argument)
        const commitMsg = issue 
          ? `fix: ${issue.title} (#${number})`
          : `fix: Issue #${number}`;
        
        spawnSync('git', ['commit', '-m', commitMsg], {
          cwd: repoCwd,
          stdio: 'inherit',
        });
        
        console.log(chalk.green('✓ Changes committed\n'));
      }
    } catch (error) {
      // If commit fails, continue - might be nothing to commit
    }
    
    // Check if there are any commits to submit
    try {
      const baseResult = spawnSync('git', ['rev-parse', '--abbrev-ref', 'origin/HEAD'], { 
        cwd: repoCwd, 
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
      const baseBranch = (baseResult.stdout || '').trim().replace('origin/', '');
      
      // Validate branch name before using it
      if (!isValidBranchName(baseBranch)) {
        console.log(chalk.red('Invalid base branch name detected.'));
        return;
      }
      
      const diffResult = spawnSync('git', ['rev-list', '--count', `${baseBranch}..HEAD`], {
        cwd: repoCwd,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
      const diffCount = (diffResult.stdout || '').trim();
      
      if (diffCount === '0') {
        console.log(chalk.yellow('No commits to submit. Make some changes first.'));
        console.log(chalk.gray('Tip: Use /fix to have Copilot implement changes, or make changes manually.'));
        return;
      }
      
      console.log(chalk.gray(`Found ${diffCount} commit(s) to submit.\n`));
    } catch {
      // Continue anyway - the PR creation will fail with a clearer error if needed
    }
    
    console.log(chalk.cyan(`📝 Preparing PR for issue #${number}...\n`));

    // Generate PR title
    console.log(chalk.gray('Generating PR title...'));
    const titlePrompt = await getPrompt('pr-title');
    let prTitle = '';
    if (titlePrompt) {
      const promptContext = buildPromptContext(context.config, { issue: issue ?? undefined });
      const renderedPrompt = renderPrompt(titlePrompt.content, promptContext);
      prTitle = await runWithNewSession(renderedPrompt, { cwd: getRepoCwd(context) });
      console.log(chalk.bold('Title: ') + prTitle.trim());
    }

    // Generate PR description
    console.log(chalk.gray('\nGenerating PR description...'));
    const descPrompt = await getPrompt('pr-description');
    let prDescription = '';
    if (descPrompt) {
      const promptContext = buildPromptContext(context.config, { issue: issue ?? undefined });
      const renderedPrompt = renderPrompt(descPrompt.content, promptContext);
      prDescription = await runWithNewSession(renderedPrompt, { cwd: getRepoCwd(context) });
      console.log(chalk.gray('─'.repeat(40)));
      // Format as markdown
      const { marked } = await import('marked');
      const TerminalRenderer = (await import('marked-terminal')).default;
      marked.setOptions({ renderer: new TerminalRenderer() as any });
      const formatted = marked(prDescription.trim()) as string;
      process.stdout.write(formatted.trimEnd());
      console.log();
      console.log(chalk.gray('─'.repeat(40)));
    }

    console.log();
    const shouldSubmit = await confirm({
      message: 'Submit this PR?',
      default: true,
    });

    if (!shouldSubmit) {
      console.log(chalk.gray('PR not submitted. You can submit manually with: gh pr create'));
      return;
    }

    // Submit via gh (safe - passed as array arguments)
    try {
      const result = spawnSync('gh', ['pr', 'create', '--title', prTitle.trim(), '--body', prDescription.trim()], {
        cwd: context.cwd,
        stdio: 'inherit',
      });
      if (result.status === 0) {
        console.log(chalk.green('\n✓ PR submitted successfully!'));
      } else {
        console.log(chalk.red('Failed to submit PR. You can submit manually with: gh pr create'));
      }
    } catch (error) {
      console.log(chalk.red('Failed to submit PR. You can submit manually with: gh pr create'));
    }
  },
};

export const explainCommand: Command = {
  name: 'explain',
  description: 'Explain the selected issue or PR',
  async execute(_args: string[], context: CommandContext) {
    if (!context.config.activeRepository) {
      console.log(chalk.yellow('No repository selected. Use /repo select first.'));
      return;
    }

    const repo = context.config.activeRepository;
    let explainOutput = '';
    
    // Helper to capture output
    const captureOutput = () => {
      const originalWrite = process.stdout.write.bind(process.stdout);
      process.stdout.write = (chunk: any) => {
        if (typeof chunk === 'string') {
          explainOutput += chunk;
        }
        return originalWrite(chunk);
      };
      return () => { process.stdout.write = originalWrite; };
    };
    
    // Check if we have an active PR or issue
    if (context.config.activePR) {
      const number = context.config.activePR;
      console.log(chalk.cyan(`\n💡 Explaining PR #${number}...\n`));
      
      const pr = await getPullRequest(repo, number);
      if (!pr) {
        console.log(chalk.red(`PR #${number} not found`));
        return;
      }
      
      // Also get related issue if there is one
      const issue = context.config.activeIssue 
        ? await getIssue(repo, context.config.activeIssue) 
        : undefined;
      
      const explainPrompt = await getPrompt('explain-pr');
      if (explainPrompt) {
        const promptContext = buildPromptContext(context.config, { 
          issue: issue ?? undefined, 
          pr: pr ?? undefined 
        });
        const renderedPrompt = renderPrompt(explainPrompt.content, promptContext);
        
        const restore = captureOutput();
        await streamToConsole(renderedPrompt, { model: context.config.defaultModel || undefined, showThinking: true, cwd: getRepoCwd(context), freshSession: true });
        restore();
        
        // Save to notes
        await createOrUpdateNote(repo.owner, repo.repo, number, 'pr', pr.title, { summary: explainOutput.trim() });
        console.log(chalk.gray('\n✓ Summary saved to notes. Use /note to view or continue discussion.'));
      }
    } else if (context.config.activeIssue) {
      const number = context.config.activeIssue;
      console.log(chalk.cyan(`\n💡 Explaining issue #${number}...\n`));
      
      const issue = await getIssue(repo, number);
      if (!issue) {
        console.log(chalk.red(`Issue #${number} not found`));
        return;
      }
      
      const explainPrompt = await getPrompt('explain-issue');
      if (explainPrompt) {
        const promptContext = buildPromptContext(context.config, { issue: issue ?? undefined });
        const renderedPrompt = renderPrompt(explainPrompt.content, promptContext);
        
        const restore = captureOutput();
        await streamToConsole(renderedPrompt, { model: context.config.defaultModel || undefined, showThinking: true, cwd: getRepoCwd(context) });
        restore();
        
        // Save to notes
        await createOrUpdateNote(repo.owner, repo.repo, number, 'issue', issue.title, { summary: explainOutput.trim() });
        console.log(chalk.gray('\n✓ Summary saved to notes. Use /note to view or continue discussion.'));
      }
    } else {
      console.log(chalk.yellow('No issue or PR selected. Use /issue or /pr to select one first.'));
      return;
    }

    console.log();
  },
};
