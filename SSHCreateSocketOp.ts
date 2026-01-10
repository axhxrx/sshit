#!/usr/bin/env bun
import { Op } from '@axhxrx/ops';
import type { Failure, IOContext, Success } from '@axhxrx/ops';
import process from 'node:process';
import { parseArgs } from 'node:util';

import { runCommand } from './sshit-internals.ts';

/**
 Information about an SSH control socket.
 */
export interface SocketInfo
{
  path: string;
  host: string;
  createdAt: string;
}

export type SSHCreateSocketFailure =
  | 'AuthenticationFailed'
  | 'HostNotFound'
  | 'HostKeyVerificationFailed'
  | 'ConnectionRefused'
  | 'PermissionDenied'
  | 'Timeout'
  | 'UnknownError';

/**
 Create a new SSH control socket in master mode.

 This establishes a persistent background connection that subsequent
 commands can multiplex over, avoiding repeated authentication.

 Usage:
   ./SSHCreateSocketOp.ts user@host
   ./SSHCreateSocketOp.ts --host user@10.0.0.3 --socket /tmp/my-socket
 */
export class SSHCreateSocketOp extends Op
{
  readonly name = 'SSHCreateSocketOp';

  readonly host: string;
  readonly socketPath: string | undefined;
  readonly connectTimeout: number;
  readonly serverAliveInterval: number;

  constructor(
    host: string,
    socketPath?: string,
    connectTimeout = 10,
    serverAliveInterval = 30,
  )
  {
    super();
    this.host = host;
    this.socketPath = socketPath;
    this.connectTimeout = connectTimeout;
    this.serverAliveInterval = serverAliveInterval;
  }

  #getSocketPath(): string
  {
    if (this.socketPath) return this.socketPath;
    const sanitized = this.host
      .replace(/@/g, '-')
      .replace(/\./g, '-')
      .replace(/:/g, '-')
      .replace(/[^a-zA-Z0-9-]/g, '');
    return `/tmp/sshit-ctrl-${sanitized}`;
  }

  async run(io?: IOContext): Promise<Success<SocketInfo> | Failure<SSHCreateSocketFailure>>
  {
    const socketPath = this.#getSocketPath();

    try
    {
      this.log(io, `Creating control socket at ${socketPath} for ${this.host}`);

      const result = await runCommand('ssh', [
        '-M',
        '-S',
        socketPath,
        '-fN',
        '-o',
        `ConnectTimeout=${this.connectTimeout}`,
        '-o',
        `ServerAliveInterval=${this.serverAliveInterval}`,
        '-o',
        'StrictHostKeyChecking=accept-new',
        this.host,
      ]);

      if (result.exitCode === 0)
      {
        const info: SocketInfo = {
          path: socketPath,
          host: this.host,
          createdAt: new Date().toISOString(),
        };
        this.log(io, `Socket created successfully`);
        return this.succeed(info);
      }

      const stderr = result.stderr;
      this.error(io, `SSH failed with exit code ${result.exitCode}: ${stderr}`);

      // Note: More specific patterns must be checked before generic ones
      if (stderr.includes('Permission denied (publickey'))
      {
        return this.fail('PermissionDenied', stderr);
      }
      if (stderr.includes('Permission denied') || stderr.includes('Authentication failed'))
      {
        return this.fail('AuthenticationFailed', stderr);
      }
      if (stderr.includes('REMOTE HOST IDENTIFICATION HAS CHANGED') || stderr.includes('Host key verification failed'))
      {
        return this.fail('HostKeyVerificationFailed', stderr);
      }
      if (stderr.includes('Could not resolve hostname') || stderr.includes('Name or service not known'))
      {
        return this.fail('HostNotFound', stderr);
      }
      if (
        stderr.includes('Connection refused')
        || stderr.includes('Network is unreachable')
        || stderr.includes('No route to host')
        || stderr.includes('Broken pipe')
      )
      {
        return this.fail('ConnectionRefused', stderr);
      }
      if (stderr.includes('Operation timed out') || stderr.includes('Connection timed out'))
      {
        return this.fail('Timeout', stderr);
      }

      return this.fail('UnknownError', `Exit code ${result.exitCode}: ${stderr}`);
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
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      host: { type: 'string', short: 'h' },
      socket: { type: 'string', short: 's' },
      timeout: { type: 'string', short: 't' },
    },
    allowPositionals: true,
  });

  const host = values.host ?? positionals[0];
  if (!host)
  {
    console.error('Usage: ./SSHCreateSocketOp.ts <host>');
    console.error('       ./SSHCreateSocketOp.ts --host user@10.0.0.3 --socket /tmp/my-socket');
    process.exit(1);
  }

  const op = new SSHCreateSocketOp(
    host,
    values.socket,
    values.timeout ? parseInt(values.timeout, 10) : undefined,
  );

  const outcome = await op.run();

  if (outcome.ok)
  {
    console.log('\n✅ Socket created successfully:');
    console.log(JSON.stringify(outcome.value, null, 2));
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
