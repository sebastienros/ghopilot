import chalk from 'chalk';
import ansiEscapes from 'ansi-escapes';
import type { Command } from '../types/index.js';
import { getAllCommands } from '../commands/registry.js';

export interface CommandPaletteOptions {
  maxVisible?: number;
  onSelect: (command: string) => void;
  onCancel: () => void;
  getPrompt: () => string;
}

export class CommandPalette {
  private commands: Command[] = [];
  private filteredCommands: Command[] = [];
  private selectedIndex: number = 0;
  private input: string = '/';
  private isActive: boolean = false;
  private maxVisible: number;
  private options: CommandPaletteOptions;
  private renderedLines: number = 0;

  constructor(options: CommandPaletteOptions) {
    this.options = options;
    this.maxVisible = options.maxVisible || 8;
    this.commands = getAllCommands();
    this.filteredCommands = this.commands;
  }

  public show(initialInput: string = '/'): void {
    this.input = initialInput;
    this.isActive = true;
    this.selectedIndex = 0;
    this.renderedLines = 0;
    this.filterCommands();
    this.render();
  }

  public hide(): void {
    this.clearMenu();
    this.isActive = false;
  }

  public isVisible(): boolean {
    return this.isActive;
  }

  public handleKeypress(key: string, ctrl: boolean, shift: boolean): boolean {
    if (!this.isActive) return false;

    if (key === 'up' || (ctrl && key === 'p')) {
      this.moveSelection(-1);
      return true;
    }

    if (key === 'down' || (ctrl && key === 'n')) {
      this.moveSelection(1);
      return true;
    }

    if (key === 'return') {
      this.selectCurrent();
      return true;
    }

    if (key === 'escape' || (ctrl && key === 'c')) {
      this.hide();
      this.options.onCancel();
      return true;
    }

    if (key === 'backspace') {
      if (this.input.length > 1) {
        this.input = this.input.slice(0, -1);
        this.filterCommands();
        this.render();
      } else {
        this.hide();
        this.options.onCancel();
      }
      return true;
    }

    if (key === 'tab') {
      if (this.filteredCommands.length > 0) {
        this.input = '/' + this.filteredCommands[this.selectedIndex].name + ' ';
        this.hide();
        this.options.onSelect(this.input);
      }
      return true;
    }

    return false;
  }

  public handleChar(char: string): void {
    if (!this.isActive) return;
    
    this.input += char;
    this.filterCommands();
    this.render();
  }

  public getInput(): string {
    return this.input;
  }

  private filterCommands(): void {
    const search = this.input.slice(1).toLowerCase();
    
    if (!search) {
      this.filteredCommands = this.commands;
    } else {
      this.filteredCommands = this.commands.filter(cmd => 
        cmd.name.toLowerCase().startsWith(search) ||
        cmd.aliases?.some(a => a.toLowerCase().startsWith(search))
      );
    }

    if (this.selectedIndex >= this.filteredCommands.length) {
      this.selectedIndex = Math.max(0, this.filteredCommands.length - 1);
    }
  }

  private moveSelection(delta: number): void {
    this.selectedIndex += delta;
    
    if (this.selectedIndex < 0) {
      this.selectedIndex = this.filteredCommands.length - 1;
    } else if (this.selectedIndex >= this.filteredCommands.length) {
      this.selectedIndex = 0;
    }
    
    this.render();
  }

  private selectCurrent(): void {
    if (this.filteredCommands.length > 0) {
      const selected = this.filteredCommands[this.selectedIndex];
      this.input = '/' + selected.name;
      this.hide();
      this.options.onSelect(this.input);
    } else {
      this.hide();
      this.options.onSelect(this.input);
    }
  }

  private clearMenu(): void {
    if (this.renderedLines > 0) {
      // Move to start of menu and clear all lines
      process.stdout.write(ansiEscapes.cursorUp(this.renderedLines) + ansiEscapes.cursorLeft);
      for (let i = 0; i < this.renderedLines; i++) {
        process.stdout.write(ansiEscapes.eraseLine + ansiEscapes.cursorDown(1));
      }
      // Move back up
      process.stdout.write(ansiEscapes.cursorUp(this.renderedLines) + ansiEscapes.cursorLeft);
      this.renderedLines = 0;
    }
  }

  private render(): void {
    const visibleCommands = this.filteredCommands.slice(0, this.maxVisible);
    
    // First, clear any previous render
    this.clearMenu();

    // Build menu content
    const lines: string[] = [];
    
    lines.push(chalk.gray('┌' + '─'.repeat(58) + '┐'));

    if (visibleCommands.length === 0) {
      lines.push(chalk.gray('│') + chalk.yellow(' No matching commands') + ' '.repeat(36) + chalk.gray('│'));
    } else {
      for (let i = 0; i < visibleCommands.length; i++) {
        const cmd = visibleCommands[i];
        const isSelected = i === this.selectedIndex;
        
        const prefix = isSelected ? chalk.cyan('│ ❯ ') : chalk.gray('│   ');
        const cmdName = isSelected 
          ? chalk.bold.white('/' + cmd.name)
          : chalk.gray('/' + cmd.name);
        
        const nameLen = cmd.name.length + 4;
        const maxDescLen = 54 - nameLen;
        const desc = cmd.description.length > maxDescLen 
          ? cmd.description.slice(0, maxDescLen - 3) + '...'
          : cmd.description;
        
        const padding = Math.max(0, 54 - nameLen - desc.length);
        const suffix = isSelected ? chalk.cyan('│') : chalk.gray('│');
        
        lines.push(prefix + cmdName + '  ' + chalk.gray(desc) + ' '.repeat(padding) + suffix);
      }

      if (this.filteredCommands.length > this.maxVisible) {
        const more = this.filteredCommands.length - this.maxVisible;
        const moreText = ` ... and ${more} more`;
        lines.push(chalk.gray('│' + moreText + ' '.repeat(57 - moreText.length) + '│'));
      }
    }

    lines.push(chalk.gray('└' + '─'.repeat(58) + '┘'));
    lines.push(chalk.gray('  ↑↓ navigate • enter select • tab complete • esc cancel'));

    // Print the menu below current line
    process.stdout.write('\n' + lines.join('\n'));
    this.renderedLines = lines.length;

    // Move cursor back to input line
    process.stdout.write(ansiEscapes.cursorUp(this.renderedLines) + ansiEscapes.cursorLeft);
    process.stdout.write(this.options.getPrompt() + this.input);
  }
}
