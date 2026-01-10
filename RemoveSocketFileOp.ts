#!/usr/bin/env bun
import { Op } from '@axhxrx/ops';
import type { Failure, IOContext, Success } from '@axhxrx/ops';
import { unlink } from 'node:fs/promises';
import process from 'node:process';
import { parseArgs } from 'node:util';

export type RemoveSocketFileFailure =
  | 'FileNotFound'
  | 'PermissionDenied'
  | 'UnknownError';

/**
 Remove a socket file from the filesystem.

 This is a simple file deletion op. It does NOT send any signals to the
 SSH master process - use SSHExitSocketOp for that.

 Usage:
   ./RemoveSocketFileOp.ts --socket /tmp/sshit-ctrl-xxx
   ./RemoveSocketFileOp.ts -s /tmp/sshit-ctrl-xxx
   ./RemoveSocketFileOp.ts ... --json
 */
export class RemoveSocketFileOp extends Op
{
  readonly name = 'RemoveSocketFileOp';

  readonly socketPath: string;

  constructor(socketPath: string)
  {
    super();
    this.socketPath = socketPath;
  }

  async run(io?: IOContext): Promise<Success<true> | Failure<RemoveSocketFileFailure>>
  {
    try
    {
      this.log(io, `Removing socket file: ${this.socketPath}`);

      await unlink(this.socketPath);

      this.log(io, 'Socket file removed');
      return this.succeed(true);
    }
    catch (error: unknown)
    {
      if (error instanceof Error)
      {
        const nodeError = error as NodeJS.ErrnoException;
        if (nodeError.code === 'ENOENT')
        {
          return this.fail('FileNotFound' as const, `File does not exist: ${this.socketPath}`);
        }
        if (nodeError.code === 'EACCES' || nodeError.code === 'EPERM')
        {
          return this.fail('PermissionDenied' as const, `Permission denied: ${this.socketPath}`);
        }
        this.error(io, `Exception: ${error.message}`);
        return this.fail('UnknownError' as const, error.message);
      }
      const message = String(error);
      this.error(io, `Exception: ${message}`);
      return this.fail('UnknownError' as const, message);
    }
  }
}

if (import.meta.main)
{
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      socket: { type: 'string', short: 's' },
      json: { type: 'boolean', short: 'j', default: false },
    },
    allowPositionals: false,
  });

  const jsonOutput = values.json ?? false;

  if (!values.socket)
  {
    console.error('Usage: ./RemoveSocketFileOp.ts --socket <path>');
    console.error('       ./RemoveSocketFileOp.ts -s /tmp/sshit-ctrl-xxx');
    process.exit(1);
  }

  const op = new RemoveSocketFileOp(values.socket);

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
        removed: true,
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
      console.log('\n✅ Socket file removed');
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
