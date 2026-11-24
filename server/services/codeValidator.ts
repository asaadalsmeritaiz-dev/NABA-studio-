import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { CodeValidationResult } from '../../src/types/studio.ts';

export interface CodeValidatorOptions {
  gppCommand?: string;
  pythonCommand?: string;
  nodeCommand?: string;
}

/**
 * Safely validates programming code examples without executing untrusted user binaries.
 * CRITICAL HONESTY RULE: Never report valid=true if the required compiler or interpreter
 * is unavailable on the host.
 */
export async function validateCodeExample(
  code: string,
  language: string,
  options?: CodeValidatorOptions,
): Promise<CodeValidationResult> {
  const normalizedLang = language.trim().toLowerCase();
  const trimmed = code.trim();

  if (!trimmed) {
    return {
      valid: false,
      unavailable: false,
      language: normalizedLang,
      validator: 'empty-check',
      diagnostics: ['Code snippet is empty.'],
    };
  }

  if (normalizedLang === 'cpp' || normalizedLang === 'c++' || normalizedLang === 'c') {
    return validateCppWithGpp(
      trimmed,
      normalizedLang === 'c' ? 'c' : 'c++',
      options?.gppCommand || 'g++',
    );
  }

  if (normalizedLang === 'python' || normalizedLang === 'py') {
    return validatePythonAst(trimmed, options?.pythonCommand || 'python3');
  }

  if (normalizedLang === 'javascript' || normalizedLang === 'js') {
    return validateJavaScriptSyntax(trimmed, options?.nodeCommand || process.execPath);
  }

  return {
    valid: false,
    unavailable: true,
    language: normalizedLang,
    validator: 'compiler-unavailable',
    diagnostics: [
      `No verified compiler or parser is configured for language "${normalizedLang}". Supported verified validators: C/C++ (g++), Python (python3 ast), JavaScript (node --check).`,
    ],
  };
}

function validateCppWithGpp(
  code: string,
  langFlag: 'c' | 'c++',
  gppCmd: string,
): Promise<CodeValidationResult> {
  return new Promise((resolve) => {
    let stderr = '';
    let settled = false;

    const child = spawn(
      gppCmd,
      ['-fsyntax-only', '-Wall', '-Wextra', '-x', langFlag, '-'],
      { shell: false },
    );

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill('SIGKILL');
        resolve({
          valid: false,
          unavailable: false,
          language: langFlag,
          validator: `${gppCmd} -fsyntax-only`,
          diagnostics: ['Syntax check timed out after 4 seconds.'],
        });
      }
    }, 4000);

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', () => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        resolve({
          valid: false,
          unavailable: true,
          language: langFlag,
          validator: `${gppCmd} (unavailable)`,
          diagnostics: [
            `Required compiler "${gppCmd}" is unavailable on this server. Cannot verify ${langFlag.toUpperCase()} syntax.`,
          ],
        });
      }
    });

    child.on('close', (exitCode) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        const lines = stderr
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean)
          .slice(0, 12);

        resolve({
          valid: exitCode === 0,
          unavailable: false,
          language: langFlag,
          validator: 'g++ -fsyntax-only',
          diagnostics:
            exitCode === 0
              ? lines.length > 0
                ? lines
                : ['Compiled cleanly with zero syntax errors (g++ -fsyntax-only).']
              : lines.length > 0
                ? lines
                : ['C++ syntax verification failed.'],
        });
      }
    });

    child.stdin.on('error', () => {
      // Prevent unhandled EPIPE if spawn fails immediately
    });
    child.stdin.write(code);
    child.stdin.end();
  });
}

function validatePythonAst(code: string, pythonCmd: string): Promise<CodeValidationResult> {
  return new Promise((resolve) => {
    let stderr = '';
    let settled = false;

    const child = spawn(
      pythonCmd,
      ['-c', 'import sys, ast; ast.parse(sys.stdin.read())'],
      { shell: false },
    );

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill('SIGKILL');
        resolve({
          valid: false,
          unavailable: false,
          language: 'python',
          validator: `${pythonCmd} ast.parse`,
          diagnostics: ['Python syntax validation timed out.'],
        });
      }
    }, 3000);

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', () => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        resolve({
          valid: false,
          unavailable: true,
          language: 'python',
          validator: `${pythonCmd} (unavailable)`,
          diagnostics: [
            `Required Python interpreter "${pythonCmd}" is unavailable on this server. Cannot verify Python syntax.`,
          ],
        });
      }
    });

    child.on('close', (exitCode) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        resolve({
          valid: exitCode === 0,
          unavailable: false,
          language: 'python',
          validator: 'python3 ast.parse',
          diagnostics:
            exitCode === 0
              ? ['Valid Python AST syntax.']
              : stderr
                  .split('\n')
                  .map((l) => l.trim())
                  .filter(Boolean)
                  .slice(-4),
        });
      }
    });

    child.stdin.on('error', () => {
      // Prevent unhandled EPIPE if spawn fails immediately
    });
    child.stdin.write(code);
    child.stdin.end();
  });
}

function validateJavaScriptSyntax(code: string, nodeCmd: string): Promise<CodeValidationResult> {
  return new Promise((resolve) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'naba-jscheck-'));
    const tmpFile = path.join(tmpDir, 'snippet.mjs');
    fs.writeFileSync(tmpFile, code, 'utf8');

    let stderr = '';
    let settled = false;
    const cleanup = () => fs.rmSync(tmpDir, { recursive: true, force: true });

    const child = spawn(nodeCmd, ['--check', tmpFile], { shell: false });

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill('SIGKILL');
        cleanup();
        resolve({
          valid: false,
          unavailable: false,
          language: 'javascript',
          validator: 'node --check',
          diagnostics: ['JavaScript syntax validation timed out.'],
        });
      }
    }, 3000);

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', () => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        cleanup();
        resolve({
          valid: false,
          unavailable: true,
          language: 'javascript',
          validator: 'node --check (unavailable)',
          diagnostics: ['Node.js syntax checker is unavailable. Cannot verify JavaScript syntax.'],
        });
      }
    });

    child.on('close', (exitCode) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        cleanup();
        resolve({
          valid: exitCode === 0,
          unavailable: false,
          language: 'javascript',
          validator: 'node --check',
          diagnostics:
            exitCode === 0
              ? ['Valid JavaScript syntax (node --check).']
              : stderr
                  .split('\n')
                  .map((l) => l.replace(tmpFile, 'snippet.js').trim())
                  .filter(Boolean)
                  .slice(0, 6),
        });
      }
    });
  });
}
