import { InfoPanel, Menu, MenuItem, MenuOp, Op } from '@axhxrx/ops';
import { AddSSHPortOp } from './AddSSHPortOp.ts';
import { AppState } from './AppState.ts';

// Global mutable state for entire app lifecycle
const state = new AppState();
state.tunnels.push(
  {
    localPort: 1234,
    remotePort: 5678,
    remoteHost: 'example.com',
    sshHost: 'ssh.example.com',
    sshUser: 'user',
    openedAt: new Date(),
    status: 'active',
  },
);

export class RootOp extends Op
{
  name = 'RootOp';

  async run()
  {
    const menu = this.buildMenu();
    const mainMenuOp = new MenuOp(menu);
    const result = await mainMenuOp.run();
    console.log(result);

    if (!result.ok)
    {
      return this.failWithUnknownError();
    }

    switch (result.value)
    {
      case 'Add SSH tunnel':
        return this.handleOutcome(new AddSSHPortOp(), (result) =>
        {
          if (result.ok)
          {
            state.tunnels.push(result.value);
          }
          return new RootOp();
        });
      case 'Quit':
        return this.cancel();
    }

    return result;
  }

  buildMenu()
  {
    const tunnelCount = state.tunnels.length;
    const tunnelSummary = tunnelCount === 0 ? 'No tunnels' : `${tunnelCount} tunnel${tunnelCount === 1 ? '' : 's'}`;

    const tunnelList = state.tunnels.map(
      tunnel => [`${tunnel.localPort} -> ${tunnel.remoteHost}:${tunnel.remotePort}`],
    );
    const header = InfoPanel.lines(
      ['SSH Tunnel Manager', tunnelSummary],
      ...tunnelList,
    );
    const footer = InfoPanel.lines('ass', 'hat');
    const menu = Menu.create(
      MenuItem.create('Add SSH tunnel')
        .help('connect a local port to a port on a remote host'),
      MenuItem.create('Quit')
        .help('Quit the program'),
    )
      .header(header)
      .footer(footer);

    return menu;
  }
}
