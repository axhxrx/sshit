/**
 Shared internals for the sshit SSH multiplexing library.

 This module provides cross-runtime compatible utilities for running
 shell commands. It uses Node.js APIs (node:child_process, node:buffer)
 intentionally for compatibility with Bun, Deno, and Node.js runtimes.
 */
import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';

/**
 Result of running a shell command with string output.
 */
export interface ShellResult
{
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 Result of running a shell command with raw Buffer output.
 Use this when you need binary-safe handling of command output.
 */
export interface ShellResultBuffers
{
  exitCode: number;
  stdoutBuffer: Buffer;
  stderrBuffer: Buffer;
}

/**
 Run a command and capture its output as strings. Cross-runtime compatible.

 Uses Node.js child_process.spawn() for compatibility across Bun, Deno,
 and Node.js runtimes.
 */
export function runCommand(command: string, args: readonly string[]): Promise<ShellResult>
{
  return new Promise((resolve) =>
  {
    const proc = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    proc.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    proc.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    proc.on('close', (code) =>
    {
      resolve({
        exitCode: code ?? 1,
        stdout: Buffer.concat(stdoutChunks).toString(),
        stderr: Buffer.concat(stderrChunks).toString(),
      });
    });

    proc.on('error', (err) =>
    {
      resolve({
        exitCode: 1,
        stdout: '',
        stderr: err.message,
      });
    });
  });
}

/**
 Run a command and capture its output as raw Buffers. Cross-runtime compatible.

 Use this variant when you need binary-safe handling of stdout/stderr,
 such as when the command output may contain non-UTF-8 data.
 */
export function runCommandBuffers(command: string, args: readonly string[]): Promise<ShellResultBuffers>
{
  return new Promise((resolve) =>
  {
    const proc = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    proc.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    proc.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    proc.on('close', (code) =>
    {
      resolve({
        exitCode: code ?? 1,
        stdoutBuffer: Buffer.concat(stdoutChunks),
        stderrBuffer: Buffer.concat(stderrChunks),
      });
    });

    proc.on('error', (err) =>
    {
      resolve({
        exitCode: 1,
        stdoutBuffer: Buffer.alloc(0),
        stderrBuffer: Buffer.from(err.message),
      });
    });
  });
}
