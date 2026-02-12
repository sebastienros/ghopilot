import { bold, cyan, gray, green, yellow, red, magenta } from '../utils/colors.ts';
import type { Command, CommandContext } from '../types/index.ts';
import { createWorktree, checkAndSwitchWorktree } from './worktrees.ts';
import { getIssue, getPullRequest, checkoutPR } from '../utils/github.ts';
import { streamToConsole, runWithNewSession } from '../utils/copilot.ts';
import { getPrompt, renderPrompt, buildPromptContext } from '../utils/prompts.ts';
import { getRepoLocalPath, formatBranchName, createOrUpdateNote } from '../utils/config.ts';
import { confirmPrompt } from '../utils/ui.ts';

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
      console.log(yellow('No repository selected. Use /repo select first.'));
      return;
    }

    const [numberStr] = args;
    let number: number;
    
    if (numberStr) {
      number = parseInt(numberStr, 10);
      if (isNaN(number)) {
        console.log(red('Invalid issue number'));
        return;
      }
    } else if (context.config.activeIssue) {
      number = context.config.activeIssue;
    } else {
      console.log(yellow('No issue specified. Use /fix <number> or select an issue with /issue first.'));
      return;
    }

    const repo = context.config.activeRepository;
    const prefix = context.config.branchPrefix || context.config.username || 'ghopilot';
    const branchName = formatBranchName(prefix, number);

    console.log(cyan(`\nFixing issue #${number}...\n`));

    // Get issue details
    const issue = await getIssue(repo, number);
    if (!issue) {
      console.log(red(`Issue #${number} not found`));
      return;
    }

    console.log(bold(issue.title));
    console.log();

    // Create worktree
    try {
      const worktreePath = await createWorktree(number, branchName, context);
      context.setCwd(worktreePath);
      context.config.activeIssue = number;
      context.config.activePR = null;
      await context.saveConfig();

      // First, create a plan
      console.log(cyan('\n📋 Creating implementation plan...\n'));
      
      const planPrompt = await getPrompt('plan');
      if (planPrompt) {
        const promptContext = buildPromptContext(context.config, { issue, branch: branchName });
        const renderedPrompt = renderPrompt(planPrompt.content, promptContext);
        
        await streamToConsole(renderedPrompt, { model: context.config.defaultModel || undefined, showThinking: true, cwd: getRepoCwd(context), freshSession: true });
      }

      console.log();
      const shouldProceed = await confirmPrompt({
        message: 'Proceed with implementation?',
        defaultValue: true,
      });

      if (!shouldProceed) {
        console.log(gray('Implementation cancelled. Worktree is ready for manual work.'));
        return;
      }

      // Implement the fix using Copilot SDK (agentic mode)
      console.log(cyan('\n🔧 Implementing fix...\n'));
      
      const fixPrompt = await getPrompt('fix');
      if (fixPrompt) {
        const promptContext = buildPromptContext(context.config, { issue, branch: branchName });
        const renderedPrompt = renderPrompt(fixPrompt.content, promptContext);
        
        // Use worktree path for agentic file editing
        await streamToConsole(renderedPrompt, { model: context.config.defaultModel || undefined, showThinking: true, cwd: worktreePath });
      }

      console.log();
      console.log(green('✓ Implementation complete.'));
      console.log(gray('Use /review to review the changes, /test to generate tests, or /submit to create a PR.'));
      console.log();

    } catch (error) {
      if (error instanceof Error) {
        console.log(red(`Error: ${error.message}`));
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
      console.log(yellow('No repository selected. Use /repo select first.'));
      return;
    }

    const repo = context.config.activeRepository;
    const number = context.config.activePR || context.config.activeIssue;
    if (!number) {
      console.log(yellow('No issue or PR selected. Use /issue or /pr to select one.'));
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

    console.log(cyan(`\n🔍 Reviewing #${number}...\n`));

    // If it's a PR, checkout first
    if (context.config.activePR) {
      console.log(gray('Checking out PR...'));
      try {
        await checkoutPR(number, context.cwd);
      } catch (error) {
        if (error instanceof Error) {
          console.log(red(`Error checking out PR: ${error.message}`));
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
      console.log(gray('\n✓ Review saved to notes. Use /note to view or continue discussion.'));
    }

    console.log();

    // Ask if user wants to fix the issues
    const shouldFix = await confirmPrompt({
      message: 'Fix the issues found in the review?',
      defaultValue: false,
    });

    if (shouldFix) {
      console.log(cyan('\n🔧 Fixing review issues...\n'));
      
      const fixReviewPrompt = await getPrompt('fix-review');
      if (fixReviewPrompt) {
        const issue = context.config.activeIssue ? await getIssue(context.config.activeRepository!, context.config.activeIssue) : undefined;
        const pr = context.config.activePR ? await getPullRequest(context.config.activeRepository!, context.config.activePR) : undefined;
        
        const promptContext = buildPromptContext(context.config, { issue: issue ?? undefined, pr: pr ?? undefined });
        const renderedPrompt = renderPrompt(fixReviewPrompt.content, promptContext);
        
        await streamToConsole(renderedPrompt, { model, showThinking: true, cwd: getRepoCwd(context) });
      }
      
      console.log();
      console.log(green('✓ Review fixes applied.'));
      console.log(gray('Use /review again to verify, or /submit to create a PR.'));
    }

    console.log();
  },
};

export const testCommand: Command = {
  name: 'test',
  description: 'Create tests for implementation or active PR',
  async execute(_args: string[], context: CommandContext) {
    if (!context.config.activeRepository) {
      console.log(yellow('No repository selected. Use /repo select first.'));
      return;
    }

    const number = context.config.activePR || context.config.activeIssue;
    if (!number) {
      console.log(yellow('No issue or PR selected. Use /issue or /pr to select one.'));
      return;
    }

    console.log(cyan(`\n🧪 Generating tests for #${number}...\n`));

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
      console.log(yellow('No repository selected. Use /repo select first.'));
      return;
    }

    const number = context.config.activePR || context.config.activeIssue;
    if (!number) {
      console.log(yellow('No issue or PR selected. Use /issue or /pr to select one.'));
      return;
    }

    console.log(cyan(`\n✅ Verifying #${number}...\n`));

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
      console.log(yellow('No repository selected. Use /repo select first.'));
      return;
    }

    if (!context.config.activePR) {
      console.log(yellow('No PR selected. Use /pr <number> to select one.'));
      return;
    }

    const number = context.config.activePR;
    console.log(cyan(`\nChecking out PR #${number}...\n`));

    try {
      await checkoutPR(number, context.cwd);
      await checkAndSwitchWorktree(number, context);
      console.log(green(`Checked out PR #${number}`));
    } catch (error) {
      if (error instanceof Error) {
        console.log(red(`Error: ${error.message}`));
      }
    }
  },
};

export const submitPrCommand: Command = {
  name: 'submit',
  description: 'Submit a PR for the current work',
  async execute(_args: string[], context: CommandContext) {
    if (!context.config.activeRepository) {
      console.log(yellow('No repository selected. Use /repo select first.'));
      return;
    }

    if (!context.config.activeIssue) {
      console.log(yellow('No issue selected. Use /fix <number> to start working on an issue.'));
      return;
    }

    const number = context.config.activeIssue;
    const issue = await getIssue(context.config.activeRepository, number);
    // Use context.cwd which should be the worktree path, not the main repo
    const repoCwd = context.cwd;
    
    // Verify we're in a worktree, not the main repo
    try {
      const result = Bun.spawnSync(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], {
        cwd: repoCwd,
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const currentBranch = (result.stdout?.toString() || '').trim();
      
      if (currentBranch === 'main' || currentBranch === 'master') {
        console.log(yellow('You are on the main branch, not a worktree.'));
        console.log(gray('Use /fix to create a worktree and start working on the issue.'));
        return;
      }
      
      console.log(gray(`Branch: ${currentBranch}\n`));
    } catch {
      // Continue
    }
    
    // Check for uncommitted changes and commit them
    try {
      const statusResult = Bun.spawnSync(['git', 'status', '--porcelain'], {
        cwd: repoCwd,
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const status = (statusResult.stdout?.toString() || '').trim();
      
      if (status) {
        console.log(cyan('📦 Uncommitted changes detected. Committing...\n'));
        
        // Stage all changes
        Bun.spawnSync(['git', 'add', '-A'], { cwd: repoCwd, stdout: 'pipe', stderr: 'pipe' });
        
        // Generate commit message
        const commitMsg = issue 
          ? `fix: ${issue.title} (#${number})`
          : `fix: Issue #${number}`;
        
        Bun.spawnSync(['git', 'commit', '-m', commitMsg], {
          cwd: repoCwd,
          stdio: ['inherit', 'inherit', 'inherit'],
        });
        
        console.log(green('✓ Changes committed\n'));
      }
    } catch (error) {
      // If commit fails, continue - might be nothing to commit
    }
    
    // Check if there are any commits to submit
    try {
      const baseResult = Bun.spawnSync(['git', 'rev-parse', '--abbrev-ref', 'origin/HEAD'], { 
        cwd: repoCwd, 
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const baseBranch = (baseResult.stdout?.toString() || '').trim().replace('origin/', '');
      
      // Validate branch name before using it
      if (!isValidBranchName(baseBranch)) {
        console.log(red('Invalid base branch name detected.'));
        return;
      }
      
      const diffResult = Bun.spawnSync(['git', 'rev-list', '--count', `${baseBranch}..HEAD`], {
        cwd: repoCwd,
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const diffCount = (diffResult.stdout?.toString() || '').trim();
      
      if (diffCount === '0') {
        console.log(yellow('No commits to submit. Make some changes first.'));
        console.log(gray('Tip: Use /fix to have Copilot implement changes, or make changes manually.'));
        return;
      }
      
      console.log(gray(`Found ${diffCount} commit(s) to submit.\n`));
    } catch {
      // Continue anyway - the PR creation will fail with a clearer error if needed
    }
    
    console.log(cyan(`📝 Preparing PR for issue #${number}...\n`));

    // Generate PR title
    console.log(gray('Generating PR title...'));
    const titlePrompt = await getPrompt('pr-title');
    let prTitle = '';
    if (titlePrompt) {
      const promptContext = buildPromptContext(context.config, { issue: issue ?? undefined });
      const renderedPrompt = renderPrompt(titlePrompt.content, promptContext);
      prTitle = await runWithNewSession(renderedPrompt, { cwd: getRepoCwd(context) });
      console.log(bold('Title: ') + prTitle.trim());
    }

    // Generate PR description
    console.log(gray('\nGenerating PR description...'));
    const descPrompt = await getPrompt('pr-description');
    let prDescription = '';
    if (descPrompt) {
      const promptContext = buildPromptContext(context.config, { issue: issue ?? undefined });
      const renderedPrompt = renderPrompt(descPrompt.content, promptContext);
      prDescription = await runWithNewSession(renderedPrompt, { cwd: getRepoCwd(context) });
      console.log(gray('─'.repeat(40)));
      process.stdout.write(prDescription.trim());
      console.log();
      console.log(gray('─'.repeat(40)));
    }

    console.log();
    const shouldSubmit = await confirmPrompt({
      message: 'Submit this PR?',
      defaultValue: true,
    });

    if (!shouldSubmit) {
      console.log(gray('PR not submitted. You can submit manually with: gh pr create'));
      return;
    }

    // Submit via gh
    try {
      const result = Bun.spawnSync(['gh', 'pr', 'create', '--title', prTitle.trim(), '--body', prDescription.trim()], {
        cwd: context.cwd,
        stdio: ['inherit', 'inherit', 'inherit'],
      });
      if (result.exitCode === 0) {
        console.log(green('\n✓ PR submitted successfully!'));
      } else {
        console.log(red('Failed to submit PR. You can submit manually with: gh pr create'));
      }
    } catch (error) {
      console.log(red('Failed to submit PR. You can submit manually with: gh pr create'));
    }
  },
};

export const explainCommand: Command = {
  name: 'explain',
  description: 'Explain the selected issue or PR',
  async execute(_args: string[], context: CommandContext) {
    if (!context.config.activeRepository) {
      console.log(yellow('No repository selected. Use /repo select first.'));
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
      console.log(cyan(`\n💡 Explaining PR #${number}...\n`));
      
      const pr = await getPullRequest(repo, number);
      if (!pr) {
        console.log(red(`PR #${number} not found`));
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
        console.log(gray('\n✓ Summary saved to notes. Use /note to view or continue discussion.'));
      }
    } else if (context.config.activeIssue) {
      const number = context.config.activeIssue;
      console.log(cyan(`\n💡 Explaining issue #${number}...\n`));
      
      const issue = await getIssue(repo, number);
      if (!issue) {
        console.log(red(`Issue #${number} not found`));
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
        console.log(gray('\n✓ Summary saved to notes. Use /note to view or continue discussion.'));
      }
    } else {
      console.log(yellow('No issue or PR selected. Use /issue or /pr to select one first.'));
      return;
    }

    console.log();
  },
};





