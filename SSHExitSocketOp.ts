#!/usr/bin/env bun
import { Op } from '@axhxrx/ops';
import type { Failure, IOContext, Success } from '@axhxrx/ops';
import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import process from 'node:process';
import { parseArgs } from 'node:util';

/**
 Result of running a shell command.
 */
interface ShellResult
{
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type SSHExitSocketFailure =
  | 'SocketNotFound'
  | 'UnknownError';

/**
 Run a command and capture its output. Cross-runtime compatible.
 */
function runCommand(command: string, args: readonly string[]): Promise<ShellResult>
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
 Gracefully request an SSH control socket to exit.

 Uses `ssh -O exit` to send the exit command to the master process.
 Returns true if the socket exited cleanly, false if the command failed
 (which may happen if the socket was already dead - that's often OK).

 Usage:
   ./SSHExitSocketOp.ts --socket /tmp/sshit-ctrl-xxx --host user@host
   ./SSHExitSocketOp.ts -s /tmp/sshit-ctrl-xxx -h user@host
   ./SSHExitSocketOp.ts ... --json
 */
export class SSHExitSocketOp extends Op
{
  readonly name = 'SSHExitSocketOp';

  readonly socketPath: string;
  readonly host: string;

  constructor(
    socketPath: string,
    host: string,
  )
  {
    super();
    this.socketPath = socketPath;
    this.host = host;
  }

  async run(io?: IOContext): Promise<Success<boolean> | Failure<SSHExitSocketFailure>>
  {
    try
    {
      // Check if socket file exists first
      try
      {
        await stat(this.socketPath);
      }
      catch
      {
        return this.fail('SocketNotFound', `Control socket does not exist: ${this.socketPath}`);
      }

      this.log(io, `Requesting socket exit: ${this.socketPath}`);

      const result = await runCommand('ssh', [
        '-S',
        this.socketPath,
        '-O',
        'exit',
        this.host,
      ]);

      // Return true if exited cleanly, false if it failed (socket may have been dead)
      const exitedCleanly = result.exitCode === 0;
      this.log(io, exitedCleanly ? 'Socket exited cleanly' : 'Socket exit command failed (may already be dead)');
      return this.succeed(exitedCleanly);
    }
    catch (error: unknown)
    {
      const message = error instanceof Error ? error.message : String(error);
      this.error(io, `Exception: ${message}`);
      return this.fail('UnknownError', message);
    }
  }
}

if (import.meta.main)
{
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      socket: { type: 'string', short: 's' },
      host: { type: 'string', short: 'h' },
      json: { type: 'boolean', short: 'j', default: false },
    },
    allowPositionals: false,
  });

  const jsonOutput = values.json ?? false;

  if (!values.socket || !values.host)
  {
    console.error('Usage: ./SSHExitSocketOp.ts --socket <path> --host <host>');
    console.error('       ./SSHExitSocketOp.ts -s /tmp/sshit-ctrl-xxx -h user@host');
    process.exit(1);
  }

  const op = new SSHExitSocketOp(values.socket, values.host);

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

  const startedAt = Date.now();
  const outcome = await op.run(jsonOutput ? silentIO : undefined);
  const endedAt = Date.now();

  if (jsonOutput)
  {
    if (outcome.ok)
    {
      console.log(JSON.stringify({
        ok: true,
        socket: values.socket,
        host: values.host,
        exitedCleanly: outcome.value,
        startedAt,
        endedAt,
        elapsedMilliseconds: endedAt - startedAt,
      }, null, 2));
    }
    else
    {
      console.log(JSON.stringify({
        ok: false,
        socket: values.socket,
        host: values.host,
        failure: outcome.failure,
        debugData: outcome.debugData,
        startedAt,
        endedAt,
        elapsedMilliseconds: endedAt - startedAt,
      }, null, 2));
      process.exit(1);
    }
  }
  else
  {
    if (outcome.ok)
    {
      const emoji = outcome.value ? '✅' : '⚠️';
      const msg = outcome.value ? 'Socket exited cleanly' : 'Socket exit failed (may already be dead)';
      console.log(`\n${emoji} ${msg}`);
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
