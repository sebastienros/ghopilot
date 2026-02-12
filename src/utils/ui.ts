// UI helpers: interactive prompts with arrow-key navigation
import * as readline from 'readline';
import { bold, cyan, gray, green, yellow, red } from './colors.ts';

const ESC = '\x1b[';
const HIDE_CURSOR = `${ESC}?25l`;
const SHOW_CURSOR = `${ESC}?25h`;
const CLEAR_LINE = `${ESC}2K`;
const MOVE_UP = (n: number) => `${ESC}${n}A`;
const MOVE_COL1 = `\r`;

export interface SelectChoice<T = string> {
  name: string;
  value: T;
}

export async function selectPrompt<T = string>(opts: {
  message: string;
  choices: SelectChoice<T>[];
  defaultValue?: T;
}): Promise<T> {
  const { choices, message } = opts;
  let selected = 0;
  let rendered = false;

  // Find default index
  if (opts.defaultValue !== undefined) {
    const idx = choices.findIndex(c => c.value === opts.defaultValue);
    if (idx >= 0) selected = idx;
  }

  const render = () => {
    // On re-renders, move cursor back to the first line of the list
    if (rendered) {
      process.stdout.write(MOVE_UP(choices.length));
    }
    rendered = true;

    for (let i = 0; i < choices.length; i++) {
      process.stdout.write(MOVE_COL1 + CLEAR_LINE);
      if (i === selected) {
        process.stdout.write(cyan('❯ ') + bold(choices[i].name));
      } else {
        process.stdout.write(gray('  ' + choices[i].name));
      }
      process.stdout.write('\n');
    }
    // Cursor is now on the line after the last choice
  };

  // Print message and initial list
  process.stdout.write(cyan(message) + '\n');
  process.stdout.write(HIDE_CURSOR);
  render();

  return new Promise<T>((resolve, reject) => {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    readline.emitKeypressEvents(process.stdin);
    process.stdin.resume();

    const cleanup = () => {
      process.stdin.removeListener('keypress', onKeypress);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      process.stdin.pause();
      // Cursor is on line after list, just show cursor
      process.stdout.write(SHOW_CURSOR);
    };

    const onKeypress = (str: string | undefined, key: { name: string; ctrl?: boolean; meta?: boolean; shift?: boolean }) => {
      if (!key) return;

      if (key.name === 'up' || key.name === 'k') {
        selected = (selected - 1 + choices.length) % choices.length;
        render();
      } else if (key.name === 'down' || key.name === 'j') {
        selected = (selected + 1) % choices.length;
        render();
      } else if (key.name === 'return') {
        cleanup();
        resolve(choices[selected].value);
      } else if (key.name === 'escape' || (key.ctrl && key.name === 'c')) {
        cleanup();
        reject(new Error('User cancelled'));
      }
    };

    process.stdin.on('keypress', onKeypress);
  });
}

export async function inputPrompt(opts: {
  message: string;
  defaultValue?: string;
}): Promise<string> {
  return lineInput(opts);
}

export async function confirmPrompt(opts: {
  message: string;
  defaultValue?: boolean;
}): Promise<boolean> {
  const defaultYes = opts.defaultValue !== false;
  const hint = defaultYes ? '(Y/n)' : '(y/N)';
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise<boolean>((resolve) => {
    rl.question(`${cyan(opts.message)} ${gray(hint)} `, (answer) => {
      rl.close();
      const a = answer.trim().toLowerCase();
      if (a === 'y' || a === 'yes') {
        resolve(true);
      } else if (a === 'n' || a === 'no') {
        resolve(false);
      } else {
        resolve(defaultYes);
      }
    });
  });
}

export async function searchPrompt<T = string>(opts: {
  message: string;
  source: (input: string) => Promise<SelectChoice<T>[]>;
}): Promise<T> {
  // First get all items with empty search
  const items = await opts.source('');
  
  return selectPrompt({
    message: opts.message,
    choices: items,
  });
}

// Simple line input that uses readline
export async function lineInput(opts: {
  message: string;
  defaultValue?: string;
}): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  
  return new Promise<string>((resolve) => {
    const prompt = opts.defaultValue 
      ? `${cyan(opts.message)} ${gray(`(${opts.defaultValue})`)} `
      : `${cyan(opts.message)} `;
    
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer || opts.defaultValue || '');
    });
  });
}
