#!/usr/bin/env bun
import { Op } from '@axhxrx/ops';
import type { Failure, IOContext, Success } from '@axhxrx/ops';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { SSHCheckSocketOp } from './SSHCheckSocketOp.ts';

/**
 Result of validating a socket.
 */
export interface ValidationResult
{
  valid: boolean;
  status: 'alive' | 'dead' | 'not-found';
}

export type ValidateSocketFailure = 'UnknownError';

/**
 Validate whether an SSH control socket is usable.

 Returns a structured result indicating:
 - valid: true if the socket can be used for commands
 - status: 'alive', 'dead', or 'not-found'

 This is a thin wrapper around SSHCheckSocketOp that converts its result
 into a more convenient format for decision-making.

 Usage:
   ./ValidateSocketOp.ts --socket /tmp/sshit-ctrl-xxx --host user@host
   ./ValidateSocketOp.ts -s /tmp/sshit-ctrl-xxx -h user@host
   ./ValidateSocketOp.ts ... --json
 */
export class ValidateSocketOp extends Op
{
  readonly name = 'ValidateSocketOp';

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

  async run(io?: IOContext): Promise<Success<ValidationResult> | Failure<ValidateSocketFailure>>
  {
    try
    {
      this.log(io, `Validating socket: ${this.socketPath}`);

      const checkOutcome = await new SSHCheckSocketOp(this.socketPath, this.host).run(io);

      if (!checkOutcome.ok)
      {
        if (checkOutcome.failure === 'SocketNotFound')
        {
          this.log(io, 'Socket not found');
          return this.succeed({ valid: false, status: 'not-found' as const });
        }
        return this.fail('UnknownError' as const, checkOutcome.debugData);
      }

      const status = checkOutcome.value;
      const valid = status === 'alive';

      this.log(io, `Socket is ${status}, valid=${valid}`);
      return this.succeed({ valid, status });
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
    console.error('Usage: ./ValidateSocketOp.ts --socket <path> --host <host>');
    console.error('       ./ValidateSocketOp.ts -s /tmp/sshit-ctrl-xxx -h user@host');
    process.exit(1);
  }

  const op = new ValidateSocketOp(values.socket, values.host);

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
        valid: outcome.value.valid,
        status: outcome.value.status,
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
      const { valid, status } = outcome.value;
      const emoji = valid ? '✅' : (status === 'dead' ? '💀' : '❓');
      console.log(`\n${emoji} Socket validation: ${status}`);
      console.log(`   Can be used: ${valid ? 'yes' : 'no'}`);
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
