# ghopilot

Interactive CLI for managing work across GitHub repositories with Copilot AI assistance.

## Features

- **Repository Management**: Add, remove, list, and select GitHub repositories
- **Issue & PR Tracking**: List and select issues/PRs with filters (assignee, author, reviewer)
- **AI-Powered Development**: Fix issues, review code, generate tests with Copilot AI
- **Worktree Management**: Automatic worktree creation for isolated development
- **Interactive REPL**: Slash-command interface with tab completion

## Installation

```bash
# Install globally
bun install -g ghopilot

# Or run from this directory
bun install
bun run start
```

## Requirements

- [Bun](https://bun.sh/) 1.2+
- [GitHub CLI](https://cli.github.com/) (`gh`) installed and authenticated
- GitHub Copilot subscription (for AI features)

## Usage

```bash
# Start interactive mode
ghopilot

# Start with a specific repository
ghopilot --repo owner/repo
```

## Commands

### Repository Management
| Command | Description |
|---------|-------------|
| `/repo` | Show current active repository |
| `/repo list` or `/repos` | List configured repositories |
| `/repo add <owner/repo>` | Add a repository |
| `/repo remove <owner/repo>` | Remove a repository |
| `/repo select [owner/repo]` | Select active repository |

### Issues
| Command | Description |
|---------|-------------|
| `/issue` | Show current active issue |
| `/issue list` or `/issues` | List issues |
| `/issue list --assignee <user>` | List issues assigned to user |
| `/issue list --assignee me` | List issues assigned to you |
| `/issue <number>` | Select an issue |

### Pull Requests
| Command | Description |
|---------|-------------|
| `/pr` | Show current active PR |
| `/pr list` or `/prs` | List PRs |
| `/pr list --author <user>` | List PRs by author |
| `/pr list --reviewer me` | List PRs where you're a reviewer |
| `/pr <number>` | Select a PR |

### AI Commands
| Command | Description |
|---------|-------------|
| `/fix <number>` | Fix an issue using Copilot AI |
| `/review` | Review current implementation or active PR |
| `/test` | Generate tests for the implementation |
| `/verify` | Verify implementation with scenarios |
| `/checkout` | Checkout the active PR locally |
| `/submit` | Submit a PR for current work |

### Worktrees
| Command | Description |
|---------|-------------|
| `/worktree list` or `/worktrees` | List ghopilot worktrees |
| `/worktree remove <number>` | Remove a worktree |
| `/worktree clean` | Remove all ghopilot worktrees |

### Configuration
| Command | Description |
|---------|-------------|
| `/config` | Show current configuration |
| `/config username <name>` | Set your GitHub username (for `me` shortcut) |
| `/config prefix <prefix>` | Set branch prefix |

### Prompts
| Command | Description |
|---------|-------------|
| `/prompt list` or `/prompts` | List all prompt templates |
| `/prompt show <name>` | View a prompt template |
| `/prompt customize <name>` | Export prompt to user folder for editing |
| `/prompt reset <name>` | Revert a prompt to default |
| `/prompt reset --all` | Revert all prompts to defaults |

### Other
| Command | Description |
|---------|-------------|
| `/help` or `/` | Show help |
| `/exit` or `/quit` | Exit ghopilot |

## Configuration

Configuration is stored in `~/.ghopilot/config.json`:

```json
{
  "repositories": [
    { "owner": "octocat", "repo": "hello-world", "lastUsed": "2024-01-01T00:00:00Z" }
  ],
  "activeRepository": { "owner": "octocat", "repo": "hello-world" },
  "activeIssue": null,
  "activePR": null,
  "username": "myusername",
  "branchPrefix": "myusername"
}
```

## Prompt Templates

Prompts are used by AI commands and can be customized. Default prompts are built-in; customizations are stored in `~/.ghopilot/prompts/`.

Available prompts:
- `fix` - Prompt for fixing an issue
- `plan` - Prompt for planning implementation
- `review` - Prompt for code review
- `test` - Prompt for generating tests
- `verify` - Prompt for verification scenarios
- `pr-title` - Prompt for generating PR title
- `pr-description` - Prompt for generating PR description

### Template Variables

| Variable | Description |
|----------|-------------|
| `{{issue_number}}` | Current issue number |
| `{{issue_title}}` | Current issue title |
| `{{issue_body}}` | Current issue body |
| `{{pr_number}}` | Current PR number |
| `{{pr_title}}` | Current PR title |
| `{{pr_body}}` | Current PR body |
| `{{repo}}` | Repository (owner/repo) |
| `{{branch}}` | Current branch name |
| `{{username}}` | Configured username |
| `{{prefix}}` | Configured branch prefix |

Conditionals: `{{#if variable}}...{{/if}}`

## Worktree Naming Convention

When you use `/fix <number>`, ghopilot creates a worktree at:
```
../<repo>-ghopilot-<number>
```

With branch name:
```
<prefix>/<number>
```

## Development

```bash
# Install dependencies
bun install

# Run directly (no build step needed)
bun run src/index.ts

# Watch mode
bun run dev

# Run tests
bun test
```

## License

MIT
