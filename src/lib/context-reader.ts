/**
 * Context reader for CONTEXT.md and directory contents
 *
 * Reads contextual information from the working directory,
 * similar to how Claude Code reads CLAUDE.md files.
 */

import { readdir, stat, realpath } from 'fs/promises';
import { join, basename, resolve, relative } from 'path';
import type { ContextInfo } from '../types/api';

const DEFAULT_CONTEXT_FILENAME = 'CONTEXT.md';

/**
 * Validate that a directory is safe to read (no path traversal)
 * @throws Error if path is unsafe
 */
function validateSafePath(requestedPath: string, basePath: string): void {
  const resolvedRequested = resolve(requestedPath);
  const resolvedBase = resolve(basePath);

  // Check if requested path is within or equal to base path
  const relativePath = relative(resolvedBase, resolvedRequested);
  if (relativePath.startsWith('..') || resolve(resolvedBase, relativePath) !== resolvedRequested) {
    throw new Error(`Path traversal detected: ${requestedPath} is outside allowed base ${basePath}`);
  }
}

/**
 * Read context information from a directory
 */
export async function readContextFromDirectory(
  directory: string,
  contextFileName: string = DEFAULT_CONTEXT_FILENAME
): Promise<ContextInfo> {
  // Validate directory path is safe (within current working directory or explicitly allowed)
  const cwd = process.cwd();
  try {
    validateSafePath(directory, cwd);
  } catch (error) {
    console.error(`Path validation failed for ${directory}:`, error);
    return {
      contextMd: null,
      directoryContents: [],
      workingDirectory: directory,
    };
  }

  const result: ContextInfo = {
    contextMd: null,
    directoryContents: [],
    workingDirectory: directory,
  };

  try {
    // Resolve symlinks to prevent symlink attacks
    const realDir = await realpath(directory);
    validateSafePath(realDir, cwd);

    // Read CONTEXT.md if it exists
    const contextPath = join(realDir, contextFileName);
    const contextFile = Bun.file(contextPath);

    if (await contextFile.exists()) {
      result.contextMd = await contextFile.text();
    }

    // List directory contents
    result.directoryContents = await listDirectoryContents(realDir);
  } catch (error) {
    console.error(`Error reading context from ${directory}:`, error);
  }

  return result;
}

/**
 * List directory contents with file types
 */
async function listDirectoryContents(
  directory: string,
  maxDepth: number = 2
): Promise<string[]> {
  const contents: string[] = [];

  async function traverse(dir: string, depth: number, prefix: string = ''): Promise<void> {
    if (depth > maxDepth) return;

    try {
      const entries = await readdir(dir, { withFileTypes: true });

      // Sort: directories first, then files
      entries.sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      });

      for (const entry of entries) {
        // Skip hidden files and common non-content directories
        if (entry.name.startsWith('.')) continue;
        if (['node_modules', '__pycache__', 'venv', '.git'].includes(entry.name)) continue;

        const fullPath = join(dir, entry.name);
        const displayPath = prefix ? `${prefix}/${entry.name}` : entry.name;

        if (entry.isDirectory()) {
          contents.push(`📁 ${displayPath}/`);
          await traverse(fullPath, depth + 1, displayPath);
        } else {
          const stats = await stat(fullPath);
          const sizeStr = formatFileSize(stats.size);
          contents.push(`📄 ${displayPath} (${sizeStr})`);
        }
      }
    } catch (error) {
      // Only silently skip permission errors; log unexpected errors
      const isPermissionError =
        error instanceof Error &&
        (error.message.includes('EACCES') || error.message.includes('EPERM'));
      if (!isPermissionError) {
        console.error(`[context-reader] Error reading ${dir}:`, error);
      }
    }
  }

  await traverse(directory, 0);
  return contents;
}

/**
 * Format file size for display
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * Build context string for injection into prompt
 */
export function buildContextString(contextInfo: ContextInfo): string {
  const parts: string[] = [];

  parts.push(`Working directory: ${contextInfo.workingDirectory}`);
  parts.push('');

  if (contextInfo.contextMd) {
    parts.push('=== CONTEXT.md ===');
    parts.push(contextInfo.contextMd);
    parts.push('');
  }

  if (contextInfo.directoryContents.length > 0) {
    parts.push('=== Directory contents ===');
    parts.push(contextInfo.directoryContents.join('\n'));
  }

  return parts.join('\n');
}

/**
 * Read specific files and return their contents
 */
export async function readContextFiles(
  directory: string,
  filenames: string[]
): Promise<Map<string, string>> {
  const contents = new Map<string, string>();

  for (const filename of filenames) {
    try {
      const filepath = join(directory, filename);

      // Validate path to prevent traversal attacks
      validateSafePath(filepath, directory);

      const file = Bun.file(filepath);

      if (await file.exists()) {
        contents.set(filename, await file.text());
      }
    } catch (error) {
      console.error(`Error reading ${filename}:`, error);
    }
  }

  return contents;
}
