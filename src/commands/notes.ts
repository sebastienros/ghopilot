import { bold, cyan, gray, green, yellow, red, magenta } from '../utils/colors.ts';
import type { Command, CommandContext, Note } from '../types/index.ts';
import { getNote, listNotes, addNoteEntry, saveNote, deleteNote } from '../utils/config.ts';
import { getIssue, getPullRequest } from '../utils/github.ts';
import { streamToConsole } from '../utils/copilot.ts';
import { getRepoLocalPath } from '../utils/config.ts';

function getRepoCwd(context: CommandContext): string | undefined {
  if (context.config.activeRepository) {
    return getRepoLocalPath(
      context.config, 
      context.config.activeRepository.owner, 
      context.config.activeRepository.repo
    );
  }
  return undefined;
}

export const noteCommand: Command = {
  name: 'note',
  description: 'View or add notes to the active issue/PR',
  args: [
    { name: 'message', description: 'Add a note or continue discussion', required: false },
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

    const type = context.config.activePR ? 'pr' : 'issue';
    const note = await getNote(repo.owner, repo.repo, number);

    // If no note exists, show message
    if (!note) {
      console.log(yellow(`\nNo notes for ${type} #${number} yet.`));
      console.log(gray('Use /explain or /review first to create a summary.\n'));
      return;
    }

    // If message provided, continue discussion
    const message = args.join(' ').trim();
    if (message) {
      await continueDiscussion(note, message, context);
      return;
    }

    // Otherwise show the note
    await displayNote(note);
  },
};

export const notesCommand: Command = {
  name: 'notes',
  description: 'List all notes for the active repository',
  async execute(_args: string[], context: CommandContext) {
    if (!context.config.activeRepository) {
      console.log(yellow('No repository selected. Use /repo select first.'));
      return;
    }

    const repo = context.config.activeRepository;
    const notes = await listNotes(repo.owner, repo.repo);

    if (notes.length === 0) {
      console.log(yellow('\nNo notes found for this repository.'));
      console.log(gray('Use /explain or /review on an issue/PR to create notes.\n'));
      return;
    }

    console.log(bold('\nNotes:\n'));

    for (const note of notes) {
      const typeIcon = note.type === 'pr' ? magenta('PR') : green('Issue');
      const activeNumber = context.config.activePR || context.config.activeIssue;
      const isActive = note.number === activeNumber;
      const prefix = isActive ? cyan('● ') : '  ';
      
      console.log(
        prefix +
        typeIcon + ' ' +
        bold(`#${note.number}`) + ' ' +
        note.title +
        gray(` (${note.discussion.length} notes)`)
      );
    }
    console.log();
  },
};

export const clearNoteCommand: Command = {
  name: 'clearnote',
  description: 'Clear notes for the active issue/PR',
  async execute(_args: string[], context: CommandContext) {
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

    const deleted = await deleteNote(repo.owner, repo.repo, number);
    if (deleted) {
      console.log(green(`✓ Notes cleared for #${number}`));
    } else {
      console.log(yellow(`No notes found for #${number}`));
    }
  },
};

async function displayNote(note: Note): Promise<void> {
  const typeLabel = note.type === 'pr' ? 'PR' : 'Issue';
  
  console.log(bold(cyan(`\n${typeLabel} #${note.number}`)) + ' ' + bold(note.title));
  console.log(gray('─'.repeat(60)));

  // Show summary
  if (note.summary) {
    console.log(bold('\n📋 Summary:\n'));
    console.log(note.summary);
  }

  // Show review
  if (note.review) {
    console.log(bold('\n🔍 Review:\n'));
    console.log(note.review);
  }

  // Show discussion
  if (note.discussion.length > 0) {
    console.log(bold('\n💬 Discussion:\n'));
    for (const entry of note.discussion) {
      const roleIcon = entry.role === 'user' ? cyan('You:') : green('AI:');
      const time = new Date(entry.timestamp).toLocaleString();
      console.log(roleIcon + gray(` (${time})`));
      console.log(entry.content);
      console.log();
    }
  }

  console.log(gray('─'.repeat(60)));
  console.log(gray('Use /note <message> to add a note or continue discussion.\n'));
}

async function continueDiscussion(note: Note, message: string, context: CommandContext): Promise<void> {
  const repo = context.config.activeRepository!;
  
  // Add user message to discussion
  await addNoteEntry(repo.owner, repo.repo, note.number, {
    role: 'user',
    content: message,
    timestamp: new Date().toISOString(),
  });

  console.log(cyan('\n🤔 Thinking...\n'));

  // Build context for AI
  const issue = note.type === 'issue' 
    ? await getIssue(repo, note.number) 
    : undefined;
  const pr = note.type === 'pr' 
    ? await getPullRequest(repo, note.number) 
    : undefined;

  // Build conversation history
  const history = note.discussion.map(e => 
    `${e.role === 'user' ? 'User' : 'Assistant'}: ${e.content}`
  ).join('\n\n');

  const contextInfo = issue 
    ? `Issue #${note.number}: ${issue.title}\nState: ${issue.state}\nLabels: ${issue.labels.join(', ')}`
    : pr 
    ? `PR #${note.number}: ${pr.title}\nState: ${pr.state}\nBranch: ${pr.headBranch} → ${pr.baseBranch}`
    : `${note.type} #${note.number}: ${note.title}`;

  const prompt = `You are helping a developer track their work on a GitHub ${note.type}.

Context:
${contextInfo}

${note.summary ? `Current summary:\n${note.summary}` : ''}
${note.review ? `Current review notes:\n${note.review}` : ''}

Previous discussion:
${history}

User's new message: ${message}

First, respond to the user's message helpfully and concisely.

Then, output an updated summary that incorporates any new information from this discussion. The summary should be a comprehensive but concise overview of the ${note.type}, including any blockers, implementation details, or notes the user has mentioned.

Format your response EXACTLY as:
---RESPONSE---
[Your response to the user]
---SUMMARY---
[Updated summary incorporating all relevant information]`;

  // Get AI response
  let fullResponse = '';
  const originalWrite = process.stdout.write.bind(process.stdout);
  let showOutput = true;
  
  process.stdout.write = (chunk: any) => {
    if (typeof chunk === 'string') {
      fullResponse += chunk;
      // Only show the response part, not the summary
      if (fullResponse.includes('---SUMMARY---')) {
        showOutput = false;
      }
      if (showOutput) {
        return originalWrite(chunk);
      }
    }
    return true;
  };

  await streamToConsole(prompt, { showThinking: false, cwd: getRepoCwd(context) });
  
  process.stdout.write = originalWrite;

  // Parse response and summary
  let response = fullResponse;
  let newSummary = note.summary;
  
  if (fullResponse.includes('---RESPONSE---') && fullResponse.includes('---SUMMARY---')) {
    const parts = fullResponse.split('---SUMMARY---');
    response = parts[0].replace('---RESPONSE---', '').trim();
    newSummary = parts[1].trim();
  }

  // Save AI response to discussion
  await addNoteEntry(repo.owner, repo.repo, note.number, {
    role: 'assistant',
    content: response,
    timestamp: new Date().toISOString(),
  });

  // Update summary automatically
  const updatedNote = await getNote(repo.owner, repo.repo, note.number);
  if (updatedNote && newSummary !== note.summary) {
    updatedNote.summary = newSummary;
    await saveNote(updatedNote);
    console.log(gray('\n✓ Summary updated.'));
  }

  console.log();
}





