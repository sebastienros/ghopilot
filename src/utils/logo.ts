import chalk from 'chalk';
import gradientString from 'gradient-string';

const LOGO = `
   _____ _    _  ____  _____ _____ _      ____ _______ 
  / ____| |  | |/ __ \\|  __ \\_   _| |    / __ \\__   __|
 | |  __| |__| | |  | | |__) || | | |   | |  | | | |   
 | | |_ |  __  | |  | |  ___/ | | | |   | |  | | | |   
 | |__| | |  | | |__| | |    _| |_| |___| |__| | | |   
  \\_____|_|  |_|\\____/|_|   |_____|______\\____/  |_|   
`;

const gradient = gradientString(['#6e5494', '#0366d6', '#2ea44f']);

export async function displayLogo(): Promise<void> {
  const lines = LOGO.split('\n');
  
  // Clear any previous content and move cursor
  process.stdout.write('\n');
  
  // Animate each line with a slight delay
  for (const line of lines) {
    if (line.trim()) {
      process.stdout.write(gradient(line) + '\n');
      await sleep(50);
    }
  }
  
  // Add tagline
  await sleep(100);
  console.log();
  console.log(chalk.gray('  GitHub Repository Work Manager with Copilot AI'));
  console.log();
}

export function displayLogoSync(): void {
  console.log(gradient(LOGO));
  console.log(chalk.gray('  GitHub Repository Work Manager with Copilot AI'));
  console.log();
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
