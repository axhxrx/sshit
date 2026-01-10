#!/usr/bin/env bun
import { Op } from '@axhxrx/ops';
import type { Failure, IOContext, Success } from '@axhxrx/ops';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { RemoveSocketFileOp } from './RemoveSocketFileOp.ts';
import { SSHExitSocketOp } from './SSHExitSocketOp.ts';

/**
 Result of tearing down a socket.
 */
export interface TearDownResult
{
  exitedCleanly: boolean;
  fileRemoved: boolean;
}

export type TearDownSocketFailure =
  | 'RemoveFailed'
  | 'UnknownError';

/**
 Tear down an SSH control socket completely.

 This composite op:
 1. Sends exit command to the master process (may fail if already dead, that's OK)
 2. Removes the socket file from the filesystem

 The op succeeds as long as the socket file is removed. The exit command
 failing is not considered a failure since the socket may already be dead.

 Usage:
   ./TearDownSocketOp.ts --socket /tmp/sshit-ctrl-xxx --host user@host
   ./TearDownSocketOp.ts -s /tmp/sshit-ctrl-xxx -h user@host
   ./TearDownSocketOp.ts ... --json
 */
export class TearDownSocketOp extends Op
{
  readonly name = 'TearDownSocketOp';

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

  async run(io?: IOContext): Promise<Success<TearDownResult> | Failure<TearDownSocketFailure>>
  {
    try
    {
      this.log(io, `Tearing down socket: ${this.socketPath}`);

      // Step 1: Try to exit gracefully (ignore failure - socket may be dead)
      let exitedCleanly = false;
      const exitOutcome = await new SSHExitSocketOp(this.socketPath, this.host).run(io);
      if (exitOutcome.ok)
      {
        exitedCleanly = exitOutcome.value;
      }
      // If exit failed with SocketNotFound, the file doesn't exist - we're done
      if (!exitOutcome.ok && exitOutcome.failure === 'SocketNotFound')
      {
        this.log(io, 'Socket file does not exist, nothing to tear down');
        return this.succeed({ exitedCleanly: false, fileRemoved: false });
      }

      // Step 2: Remove the socket file
      const removeOutcome = await new RemoveSocketFileOp(this.socketPath).run(io);

      if (!removeOutcome.ok)
      {
        // FileNotFound is OK - the file may have been cleaned up by SSH
        if (removeOutcome.failure === 'FileNotFound')
        {
          this.log(io, 'Socket file already removed');
          return this.succeed({ exitedCleanly, fileRemoved: false });
        }
        return this.fail('RemoveFailed' as const, removeOutcome.debugData);
      }

      this.log(io, 'Socket torn down successfully');
      return this.succeed({ exitedCleanly, fileRemoved: true });
    }
    catch (error: unknown)
    {
      const message = error instanceof Error ? error.message : String(error);
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
      host: { type: 'string', short: 'h' },
      json: { type: 'boolean', short: 'j', default: false },
    },
    allowPositionals: false,
  });

  const jsonOutput = values.json ?? false;

  if (!values.socket || !values.host)
  {
    console.error('Usage: ./TearDownSocketOp.ts --socket <path> --host <host>');
    console.error('       ./TearDownSocketOp.ts -s /tmp/sshit-ctrl-xxx -h user@host');
    process.exit(1);
  }

  const op = new TearDownSocketOp(values.socket, values.host);

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
        exitedCleanly: outcome.value.exitedCleanly,
        fileRemoved: outcome.value.fileRemoved,
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
      const { exitedCleanly, fileRemoved } = outcome.value;
      console.log('\n✅ Socket torn down');
      console.log(`   Exit command: ${exitedCleanly ? 'succeeded' : 'failed (socket may have been dead)'}`);
      console.log(`   File removal: ${fileRemoved ? 'succeeded' : 'not needed'}`);
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
