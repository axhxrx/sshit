import { Op, PrintOp } from '@axhxrx/ops';
import type { Tunnel } from './AppState.ts';

export class AddSSHPortOp extends Op
{
  name = 'AddSSHPortOp';

  async run()
  {
    const printOp = new PrintOp('Enter local port:');
    const result = await printOp.run();
    console.log(result);

    if (!result.ok)
    {
      return this.failWithUnknownError();
    }

    const tunnel: Tunnel = {
      localPort: 3389,
      remotePort: 3389,
      remoteHost: 'localhost',
      sshHost: 'ubuntu@orb',
      sshUser: 'ubuntu',
      openedAt: undefined,
      status: 'starting',
    };
    return this.succeed(tunnel);
  }
}
