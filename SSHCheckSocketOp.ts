#!/usr/bin/env bun
import { Op } from '@axhxrx/ops';
import type { Failure, IOContext, Success } from '@axhxrx/ops';
import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import process from 'node:process';
import { parseArgs } from 'node:util';

/**
 Status of an SSH control socket.
 */
export type SocketStatus = 'alive' | 'dead';

/**
 Result of running a shell command.
 */
interface ShellResult
{
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type SSHCheckSocketFailure =
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
 Check the health of an SSH control socket.

 Uses `ssh -O check` to probe the control socket. Returns 'alive' if the
 socket is responding, 'dead' if the socket file exists but the master
 process is not responding.

 Usage:
   ./SSHCheckSocketOp.ts --socket /tmp/sshit-ctrl-xxx --host user@host
   ./SSHCheckSocketOp.ts -s /tmp/sshit-ctrl-xxx -h user@host
   ./SSHCheckSocketOp.ts ... --json    # Pure JSON output
 */
export class SSHCheckSocketOp extends Op
{
  readonly name = 'SSHCheckSocketOp';

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

  async run(io?: IOContext): Promise<Success<SocketStatus> | Failure<SSHCheckSocketFailure>>
  {
    try
    {
      // First check if socket file exists
      try
      {
        await stat(this.socketPath);
      }
      catch
      {
        return this.fail('SocketNotFound', `Control socket does not exist: ${this.socketPath}`);
      }

      this.log(io, `Checking socket health: ${this.socketPath}`);

      const result = await runCommand('ssh', [
        '-S',
        this.socketPath,
        '-O',
        'check',
        this.host,
      ]);

      // Exit code 0 means socket is alive
      if (result.exitCode === 0)
      {
        this.log(io, 'Socket is alive');
        return this.succeed('alive');
      }

      // Socket file exists but master is dead
      this.log(io, 'Socket is dead');
      return this.succeed('dead');
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
    console.error('Usage: ./SSHCheckSocketOp.ts --socket <path> --host <host>');
    console.error('       ./SSHCheckSocketOp.ts -s /tmp/sshit-ctrl-xxx -h user@host');
    console.error('       ./SSHCheckSocketOp.ts ... --json');
    process.exit(1);
  }

  const op = new SSHCheckSocketOp(values.socket, values.host);

  // Silent logger for JSON mode
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
        status: outcome.value,
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
      const emoji = outcome.value === 'alive' ? '✅' : '💀';
      console.log(`\n${emoji} Socket status: ${outcome.value}`);
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
