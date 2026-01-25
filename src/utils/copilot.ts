import { CopilotClient, CopilotSession } from '@github/copilot-sdk';
import type { SessionConfig, AssistantMessageEvent } from '@github/copilot-sdk';
import chalk from 'chalk';
import { marked } from 'marked';
import TerminalRenderer from 'marked-terminal';

// Configure marked to use terminal renderer
marked.setOptions({
  renderer: new TerminalRenderer({
    showSectionPrefix: false,
    reflowText: true,
    width: process.stdout.columns || 80,
  }) as any,
});

let client: CopilotClient | null = null;
let currentSession: CopilotSession | null = null;
let currentCwd: string | null = null;

export interface CopilotOptions {
  model?: string;
  cwd?: string;
  onMessage?: (content: string) => void;
  onThinking?: (thinking: string) => void;
  onComplete?: () => void;
  onError?: (error: Error) => void;
}

export async function initCopilotClient(cwd?: string): Promise<CopilotClient> {
  // If cwd changed, restart client with new cwd
  if (client && cwd && cwd !== currentCwd) {
    await stopCopilotClient();
  }
  
  if (client) {
    return client;
  }

  currentCwd = cwd || process.cwd();
  
  client = new CopilotClient({
    // Suppress SDK logs
    logLevel: 'none',
    // Set working directory for the CLI process
    cwd: currentCwd,
  });

  await client.start();
  return client;
}

export async function stopCopilotClient(): Promise<void> {
  if (currentSession) {
    await currentSession.destroy();
    currentSession = null;
  }
  if (client) {
    await client.stop();
    client = null;
  }
}

export async function createSession(config?: SessionConfig): Promise<CopilotSession> {
  const c = await initCopilotClient();
  currentSession = await c.createSession(config);
  return currentSession;
}

export async function sendPrompt(
  prompt: string,
  options: CopilotOptions = {}
): Promise<string> {
  const c = await initCopilotClient(options.cwd);
  
  // Create a new session if none exists or cwd changed
  if (!currentSession) {
    const sessionConfig: SessionConfig = {};
    if (options.model) {
      sessionConfig.model = options.model;
    }
    currentSession = await c.createSession(sessionConfig);
  }

  return new Promise((resolve, reject) => {
    let fullResponse = '';
    let hasResolved = false;

    // Set up event handler
    currentSession!.on((event) => {
      const eventType = event.type as string;
      const eventData = (event as any).data;
      
      // Debug: uncomment to see events
      // console.log('EVENT:', eventType, JSON.stringify(eventData || {}).slice(0, 200));
      
      if (eventType === 'assistant.message') {
        // Content comes in assistant.message event
        const content = eventData?.content;
        if (content && typeof content === 'string') {
          fullResponse += content;
          options.onMessage?.(content);
        }
      } else if (eventType === 'assistant.message_delta' || eventType === 'content_block_delta') {
        const content = eventData?.delta?.text || eventData?.delta || eventData?.content;
        if (content && typeof content === 'string') {
          fullResponse += content;
          options.onMessage?.(content);
        }
      } else if (eventType === 'assistant.reasoning' || eventType === 'assistant.reasoning_delta') {
        // Reasoning/thinking content
        const thinking = eventData?.reasoning || eventData?.delta;
        if (thinking) {
          options.onThinking?.(thinking);
        }
      } else if (eventType === 'assistant.turn_end') {
        // Don't resolve here - wait for session.idle
      } else if (eventType === 'session.idle') {
        // Session is done
        if (!hasResolved) {
          hasResolved = true;
          options.onComplete?.();
          resolve(fullResponse);
        }
      } else if (eventType === 'session.error' || eventType === 'error') {
        const error = new Error(eventData?.message || 'Unknown error');
        options.onError?.(error);
        if (!hasResolved) {
          hasResolved = true;
          reject(error);
        }
      }
    });

    // Send the prompt and handle the response stream directly
    currentSession!.send({ prompt }).then((response: any) => {
      // send() returns a message ID, not content - ignore it
      // Content comes via events
    }).catch((err: Error) => {
      if (!hasResolved) {
        hasResolved = true;
        reject(err);
      }
    });

    // Timeout fallback
    setTimeout(() => {
      if (!hasResolved) {
        hasResolved = true;
        options.onComplete?.();
        resolve(fullResponse);
      }
    }, 120000); // 2 minute timeout
  });
}

export async function listModels(): Promise<string[]> {
  const c = await initCopilotClient();
  const models = await c.listModels();
  return models.map(m => m.id);
}

export async function runWithNewSession(
  prompt: string,
  options: CopilotOptions = {}
): Promise<string> {
  // Destroy existing session to start fresh
  if (currentSession) {
    await currentSession.destroy();
    currentSession = null;
  }
  return sendPrompt(prompt, options);
}

// Stream response to console with real-time output
export async function streamToConsole(
  prompt: string,
  options: { model?: string; showThinking?: boolean; formatMarkdown?: boolean; cwd?: string } = {}
): Promise<string> {
  let isFirstChunk = true;
  const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let spinnerIndex = 0;
  let spinnerInterval: NodeJS.Timeout | null = null;
  let fullContent = '';

  // Start spinner
  spinnerInterval = setInterval(() => {
    process.stdout.write(`\r${spinnerFrames[spinnerIndex]} Thinking...`);
    spinnerIndex = (spinnerIndex + 1) % spinnerFrames.length;
  }, 80);

  const stopSpinner = () => {
    if (spinnerInterval) {
      clearInterval(spinnerInterval);
      spinnerInterval = null;
      process.stdout.write('\r\x1b[K'); // Clear the spinner line
    }
  };

  try {
    await sendPrompt(prompt, {
      model: options.model,
      cwd: options.cwd,
      onMessage: (content) => {
        if (isFirstChunk) {
          stopSpinner();
          isFirstChunk = false;
        }
        fullContent += content;
        // Don't stream raw - wait for complete response to format
      },
      onThinking: (thinking) => {
        if (options.showThinking) {
          stopSpinner();
          process.stdout.write(chalk.gray(thinking));
        }
      },
      onComplete: () => {
        stopSpinner();
        // Format and display the complete response
        if (fullContent) {
          if (options.formatMarkdown !== false) {
            const formatted = marked(fullContent) as string;
            process.stdout.write(formatted.trimEnd());
          } else {
            process.stdout.write(fullContent);
          }
        }
        console.log(); // New line at end
      },
      onError: (error) => {
        stopSpinner();
        console.error(chalk.red(`\nError: ${error.message}`));
      },
    });
  } finally {
    stopSpinner();
  }
  
  return fullContent;
}

// Check if Copilot CLI is available and authenticated
export async function checkCopilotStatus(): Promise<{ available: boolean; authenticated: boolean; error?: string }> {
  try {
    const c = await initCopilotClient();
    const authStatus = await c.getAuthStatus();
    return {
      available: true,
      authenticated: authStatus.isAuthenticated,
    };
  } catch (error) {
    return {
      available: false,
      authenticated: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
