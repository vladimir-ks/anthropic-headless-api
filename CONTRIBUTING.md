# Contributing Guide

## Development Setup

1. **Prerequisites**
   ```bash
   # Install Bun
   curl -fsSL https://bun.sh/install | bash

   # Verify installation
   bun --version
   ```

2. **Clone & Install**
   ```bash
   git clone https://github.com/vladimir-ks/anthropic-headless-api.git
   cd anthropic-headless-api
   bun install
   ```

3. **Verify Setup**
   ```bash
   bun run validate
   # Should show: TypeScript ✅ Clean, Tests ✅ 48 pass
   ```

## Development Workflow

### Running Tests

```bash
# Run unit tests only (default)
bun run test

# Run all tests (including integration)
bun run test:all

# Run security tests
bun run test:security

# Run integration tests (requires server running)
bun run test:integration

# Watch mode
bun run test:watch

# Full validation (type check + tests)
bun run validate
```

### Running the Server

```bash
# Development mode (auto-reload)
bun run dev

# Production mode
bun run start

# Custom port
PORT=8080 bun run start

# Custom Claude config
CLAUDE_CONFIG_DIR=~/.claude-inst7 bun run start
```

### Running the CLI Client

```bash
# Default (localhost:3456)
bun run cli

# Custom server
bun run cli --host localhost --port 8080

# Custom model
bun run cli --model opus
```

## Code Quality Standards

### Security-First Development

**CRITICAL**: All new code must follow security-first principles:

1. **Input Validation**
   - Validate ALL user inputs at API boundary
   - Use Zod schemas for request validation
   - Never trust client data

2. **Path Handling**
   - Use `validateSafePath()` for any file operations
   - Always validate against base directory
   - Prevent `..` traversal and symlink attacks

3. **External Data**
   - Use `validateJSONForCLI()` for CLI parameters
   - Enforce depth (10) and size (10KB) limits
   - Check for shell injection patterns

### Error Handling

All async functions must have proper error handling:

```typescript
try {
  // Operation
} catch (error) {
  // Structured logging
  log.error('Operation failed:', {
    context: 'relevant context',
    error: error instanceof Error ? error.message : String(error),
  });

  // Graceful error response
  return {
    success: false,
    error: 'User-friendly message',
  };
} finally {
  // Resource cleanup
}
```

### Testing Requirements

**Every new feature must include tests:**

1. **Unit Tests** - Test individual functions
2. **Security Tests** - Test attack scenarios
3. **Integration Tests** - Test end-to-end flows (if applicable)

**Test Checklist:**
- [ ] Happy path tested
- [ ] Error paths tested
- [ ] Edge cases tested
- [ ] Security scenarios tested (if handling user input)

### Code Style

```typescript
// ✅ Good
async function handleRequest(req: Request): Promise<Response> {
  try {
    const data = await validateInput(req);
    return successResponse(data);
  } catch (error) {
    log.error('Request failed:', { error });
    return errorResponse(error);
  }
}

// ❌ Bad
async function handleRequest(req) {
  const data = await validateInput(req); // No error handling
  return successResponse(data);
}
```

**Naming Conventions:**
- Functions: `camelCase` (e.g., `validateSafePath`)
- Types/Interfaces: `PascalCase` (e.g., `ChatCompletionRequest`)
- Constants: `UPPER_SNAKE_CASE` (e.g., `MAX_JSON_SIZE`)
- Files: `kebab-case.ts` (e.g., `rate-limiter.ts`)

## Pull Request Process

1. **Create Feature Branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make Changes**
   - Write code
   - Add tests
   - Update documentation

3. **Validate**
   ```bash
   bun run validate
   # Must pass before submitting PR
   ```

4. **Commit**
   ```bash
   git add .
   git commit -m "feat: Add feature description

   - Detail 1
   - Detail 2
   - Closes #123"
   ```

   **Commit Message Format:**
   - `feat:` - New feature
   - `fix:` - Bug fix
   - `security:` - Security fix
   - `refactor:` - Code refactoring
   - `test:` - Test additions/changes
   - `docs:` - Documentation changes

5. **Push & Create PR**
   ```bash
   git push origin feature/your-feature-name
   ```

6. **PR Checklist**
   - [ ] All tests passing
   - [ ] Type check passing
   - [ ] Security considerations documented
   - [ ] Documentation updated
   - [ ] No debug code (console.log, commented code)
   - [ ] CHANGELOG.md updated (if applicable)

## Architecture Overview

```
src/
├── index.ts           # Server entry point
├── routes/            # Request handlers
│   └── chat.ts        # Chat completions endpoint
├── lib/               # Core libraries
│   ├── claude-cli.ts  # CLI wrapper
│   └── context-reader.ts # File context reading
├── middleware/        # Express-like middleware
│   └── rate-limiter.ts
├── validation/        # Input validation
│   └── schemas.ts     # Zod schemas
├── types/             # TypeScript types
│   ├── api.ts         # API types
│   └── claude.ts      # Claude CLI types
└── cli/               # CLI client
    └── client.ts
```

## Security Guidelines

### Threat Model

**Primary Threats:**
1. Path traversal attacks
2. Command injection
3. JSON injection
4. Resource exhaustion
5. Rate limit bypass

**Mitigations in Place:**
- Path validation with `validateSafePath()`
- JSON validation with depth/size limits
- Shell pattern detection
- Rate limiting (60 req/min default)
- Request size limits (1MB)

### Reporting Security Issues

**DO NOT** open public issues for security vulnerabilities.

Instead:
1. Email security details to [repository owner]
2. Include: description, reproduction steps, impact assessment
3. Allow 90 days for fix before public disclosure

## Performance Considerations

### Optimization Priorities

1. **Correctness** > Performance
2. **Security** > Performance
3. **Performance** (after above)

### Known Bottlenecks

- **Claude CLI execution**: 2-30s per request (external dependency)
- **Rate limiter cleanup**: Every 60s (acceptable)
- **Session storage**: In-memory (single instance)

### Don't Optimize Prematurely

Only optimize if:
1. Profiling shows actual bottleneck
2. User impact is measurable
3. Fix doesn't compromise security

## Documentation Standards

### Code Comments

```typescript
/**
 * Brief description of what the function does
 *
 * @param param1 - Description of param1
 * @param param2 - Description of param2
 * @returns Description of return value
 * @throws Error if invalid input
 */
function example(param1: string, param2: number): Result {
  // Implementation
}
```

**When to Comment:**
- Complex algorithms
- Security-critical code
- Non-obvious logic
- Workarounds for external issues

**When NOT to Comment:**
- Self-explanatory code
- Variable declarations
- Obvious operations

### README Updates

Update README when:
- Adding new features
- Changing API behavior
- Adding environment variables
- Changing deployment process

## Questions?

- Open a discussion on GitHub
- Check existing issues
- Review production readiness docs

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
