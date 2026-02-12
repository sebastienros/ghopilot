import { cyan, magenta, green, gray } from './colors.ts';

const LOGO = `
   _____ _    _  ____  _____ _____ _      ____ _______ 
  / ____| |  | |/ __ \\|  __ \\_   _| |    / __ \\__   __|
 | |  __| |__| | |  | | |__) || | | |   | |  | | | |   
 | | |_ |  __  | |  | |  ___/ | | | |   | |  | | | |   
 | |__| | |  | | |__| | |    _| |_| |___| |__| | | |   
  \\_____|_|  |_|\\____/|_|   |_____|______\\____/  |_|   
`;

const GRADIENT_COLORS = [magenta, cyan, green];

export async function displayLogo(): Promise<void> {
  const lines = LOGO.split('\n');
  
  process.stdout.write('\n');
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim()) {
      const colorFn = GRADIENT_COLORS[i % GRADIENT_COLORS.length];
      process.stdout.write(colorFn(line) + '\n');
      await sleep(50);
    }
  }
  
  await sleep(100);
  console.log();
  console.log(gray('  GitHub Repository Work Manager with Copilot AI'));
  console.log();
}

export function displayLogoSync(): void {
  const lines = LOGO.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim()) {
      const colorFn = GRADIENT_COLORS[i % GRADIENT_COLORS.length];
      console.log(colorFn(line));
    }
  }
  console.log(gray('  GitHub Repository Work Manager with Copilot AI'));
  console.log();
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

