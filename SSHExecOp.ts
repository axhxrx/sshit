#!/usr/bin/env bun
import { Op } from '@axhxrx/ops';
import type { Failure, IOContext, Success } from '@axhxrx/ops';
import { Buffer } from 'node:buffer';
import { stat } from 'node:fs/promises';
import process from 'node:process';
import { parseArgs } from 'node:util';

import { runCommandBuffers } from './sshit-internals.ts';

/**
 Result of executing a remote SSH command.
 Includes raw Buffer data for binary-safe handling.
 */
export interface ExecResult
{
  exitCode: number;
  stdout: string;
  stderr: string;
  stdoutBuffer: Buffer;
  stderrBuffer: Buffer;
}

export type SSHExecFailure =
  | 'SocketNotFound'
  | 'SocketDead'
  | 'ConnectionFailed'
  | 'Timeout'
  | 'UnknownError';

/**
 Execute a command on a remote host via an existing SSH control socket.

 This op assumes the socket already exists. It does NOT handle socket
 creation or recovery - that's the job of the connection manager.

 IMPORTANT: This op uses `-o ControlMaster=no` which means it will ONLY
 work with an existing control socket. If the socket doesn't exist, SSH
 will fail with exit code 255 rather than falling back to a regular
 connection. This is intentional - we want to know when the socket is
 missing rather than silently degrading to slow individual connections.

 NOTE: The stderr output may contain messages from the LOCAL ssh binary
 (e.g., "Warning: Permanently added ... to the list of known hosts")
 mixed with the remote command's stderr. There is no reliable way to
 separate local SSH messages from remote stderr.

 Usage:
   ./SSHExecOp.ts --socket /tmp/sshit-ctrl-xxx --host user@host --command "ls -la"
   ./SSHExecOp.ts -s /tmp/sshit-ctrl-xxx -h user@host -c "whoami"
   ./SSHExecOp.ts ... --json                          # Pure JSON output
   ./SSHExecOp.ts ... --json --stdout-format base64   # Include base64-encoded stdout
 */
export class SSHExecOp extends Op
{
  readonly name = 'SSHExecOp';

  readonly socketPath: string;
  readonly host: string;
  readonly command: string;
  readonly timeoutSeconds: number;

  constructor(
    socketPath: string,
    host: string,
    command: string,
    timeoutSeconds = 30,
  )
  {
    super();
    this.socketPath = socketPath;
    this.host = host;
    this.command = command;
    this.timeoutSeconds = timeoutSeconds;
  }

  async run(io?: IOContext): Promise<Success<ExecResult> | Failure<SSHExecFailure>>
  {
    try
    {
      // Check if socket exists BEFORE trying to use it
      // This prevents SSH from silently falling back to a regular connection
      try
      {
        await stat(this.socketPath);
      }
      catch
      {
        return this.fail('SocketNotFound', `Control socket does not exist: ${this.socketPath}`);
      }

      this.log(io, `Executing on ${this.host} via ${this.socketPath}: ${this.command}`);

      const result = await runCommandBuffers('ssh', [
        '-S',
        this.socketPath,
        '-o',
        'ControlMaster=no',
        '-o',
        `ConnectTimeout=${this.timeoutSeconds}`,
        this.host,
        this.command,
      ]);

      const { stdoutBuffer, stderrBuffer, exitCode } = result;
      const stdout = stdoutBuffer.toString('utf-8');
      const stderr = stderrBuffer.toString('utf-8');

      // Exit code 255 indicates SSH-level failure (vs command failure)
      if (exitCode === 255)
      {
        if (stderr.includes('No such file') || stderr.includes('no such file'))
        {
          return this.fail('SocketNotFound', stderr);
        }
        if (stderr.includes('Connection refused') || stderr.includes('Connection reset'))
        {
          return this.fail('ConnectionFailed', stderr);
        }
        if (stderr.includes('Operation timed out') || stderr.includes('Connection timed out'))
        {
          return this.fail('Timeout', stderr);
        }
        if (stderr.includes('Control socket') && stderr.includes('dead'))
        {
          return this.fail('SocketDead', stderr);
        }
        // Other 255 errors - likely socket issues
        return this.fail('ConnectionFailed', `Exit 255: ${stderr}`);
      }

      // Non-255 exit codes are command results (success or command failure)
      const execResult: ExecResult = {
        exitCode,
        stdout,
        stderr,
        stdoutBuffer,
        stderrBuffer,
      };

      this.log(io, `Command completed with exit code ${exitCode}`);
      return this.succeed(execResult);
    }
    catch (error: unknown)
    {
      const message = error instanceof Error ? error.message : String(error);
      this.error(io, `Exception: ${message}`);
      return this.fail('UnknownError', message);
    }
  }
}

type OutputFormat = 'utf-8' | 'base64';

/**
 Format bytes as human-readable string (e.g., "1.32 MiB").
 */
function formatBytes(bytes: number): string
{
  if (bytes === 0) return '0 B';

  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const value = bytes / Math.pow(k, i);

  return `${value.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

interface StreamOutput
{
  text?: string;
  base64?: string;
  byteCount: number;
  size: string;
  base64ByteCount?: number;
  base64Size?: string;
}

/**
 Build the output object for stdout/stderr based on requested formats.
 Includes size metadata.
 */
function formatOutput(buffer: Buffer, formats: readonly OutputFormat[]): StreamOutput
{
  const result: StreamOutput = {
    byteCount: buffer.length,
    size: formatBytes(buffer.length),
  };

  for (const format of formats)
  {
    if (format === 'utf-8')
    {
      result.text = buffer.toString('utf-8');
    }
    else if (format === 'base64')
    {
      const base64Str = buffer.toString('base64');
      result.base64 = base64Str;
      result.base64ByteCount = base64Str.length;
      result.base64Size = formatBytes(base64Str.length);
    }
  }

  return result;
}

if (import.meta.main)
{
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      socket: { type: 'string', short: 's' },
      host: { type: 'string', short: 'h' },
      command: { type: 'string', short: 'c' },
      timeout: { type: 'string', short: 't' },
      json: { type: 'boolean', short: 'j', default: false },
      'stdout-format': { type: 'string', multiple: true },
      'stderr-format': { type: 'string', multiple: true },
    },
    allowPositionals: false,
  });

  const jsonOutput = values.json ?? false;

  // Parse format options (default to ['utf-8'] if not specified)
  const rawStdoutFormats = values['stdout-format'] ?? [];
  const rawStderrFormats = values['stderr-format'] ?? [];

  const stdoutFormats: OutputFormat[] = rawStdoutFormats.length > 0
    ? rawStdoutFormats.filter((f): f is OutputFormat => f === 'utf-8' || f === 'base64')
    : ['utf-8'];

  const stderrFormats: OutputFormat[] = rawStderrFormats.length > 0
    ? rawStderrFormats.filter((f): f is OutputFormat => f === 'utf-8' || f === 'base64')
    : ['utf-8'];

  if (!values.socket || !values.host || !values.command)
  {
    console.error('Usage: ./SSHExecOp.ts --socket <path> --host <host> --command <cmd>');
    console.error('       ./SSHExecOp.ts -s /tmp/sshit-ctrl-xxx -h user@host -c "ls -la"');
    console.error('');
    console.error('Options:');
    console.error('  --json, -j                    Output structured JSON (no other output)');
    console.error('  --stdout-format <fmt>         Format for stdout: utf-8 (default) or base64');
    console.error('  --stderr-format <fmt>         Format for stderr: utf-8 (default) or base64');
    console.error('');
    console.error('Format options can be specified multiple times to include both:');
    console.error('  --json --stdout-format utf-8 --stdout-format base64');
    process.exit(1);
  }

  const op = new SSHExecOp(
    values.socket,
    values.host,
    values.command,
    values.timeout ? parseInt(values.timeout, 10) : undefined,
  );

  // In JSON mode, suppress logging by passing a silent IOContext
  const silentLogger = {
    log: () => {},
    warn: () => {},
    error: () => {},
    child: () => silentLogger,
    getNamespace: () => undefined,
  };

  const silentIO = {
    stdin: process.stdin,
    stdout: process.stdout,
    mode: 'interactive' as const,
    logger: silentLogger,
  } as unknown as IOContext;

  // Capture timing
  const startedAt = Date.now();
  const startedAtDate = new Date(startedAt);

  const outcome = await op.run(jsonOutput ? silentIO : undefined);

  const endedAt = Date.now();
  const endedAtDate = new Date(endedAt);
  const elapsedMilliseconds = endedAt - startedAt;

  if (jsonOutput)
  {
    // Pure JSON output - nothing else
    if (outcome.ok)
    {
      const output = {
        ok: true as const,
        host: values.host,
        socket: values.socket,
        command: values.command,
        exitCode: outcome.value.exitCode,
        // Timing metadata
        startedAt,
        endedAt,
        elapsedMilliseconds,
        startedAtUTC: startedAtDate.toISOString(),
        endedAtUTC: endedAtDate.toISOString(),
        // Stream outputs with size metadata
        stdout: formatOutput(outcome.value.stdoutBuffer, stdoutFormats),
        // NOTE: stderr may contain messages from the LOCAL ssh binary (e.g., host key warnings)
        // mixed with the remote command's stderr. There's no reliable way to separate them.
        stderr: formatOutput(outcome.value.stderrBuffer, stderrFormats),
      };
      console.log(JSON.stringify(output, null, 2));
    }
    else
    {
      const output = {
        ok: false as const,
        host: values.host,
        socket: values.socket,
        command: values.command,
        failure: outcome.failure,
        debugData: outcome.debugData,
        // Timing metadata (still useful for failed commands)
        startedAt,
        endedAt,
        elapsedMilliseconds,
        startedAtUTC: startedAtDate.toISOString(),
        endedAtUTC: endedAtDate.toISOString(),
      };
      console.log(JSON.stringify(output, null, 2));
      process.exit(1);
    }
  }
  else
  {
    // Human-friendly output
    if (outcome.ok)
    {
      const { exitCode, stdout, stderr } = outcome.value;
      console.log('\n✅ Command executed:');
      console.log(`Exit code: ${exitCode}`);
      if (stdout)
      {
        console.log('\n--- stdout ---');
        console.log(stdout);
      }
      if (stderr)
      {
        console.log('\n--- stderr ---');
        console.log(stderr);
      }
    }
    else
    {
      console.error(`\n❌ Failed: ${outcome.failure}`);
      if (outcome.debugData)
      {
        console.error(outcome.debugData);
      }
      process.exit(1);
    }
  }
}
