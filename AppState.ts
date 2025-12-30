export interface Tunnel
{
  localPort: number;
  remotePort: number;
  remoteHost: string;
  sshHost: string;
  sshUser: string;
  openedAt?: Date;
  status: 'active' | 'starting' | 'failed' | 'closed';
  closedAt?: Date;
  pid?: number;
  error?: string;
}

export class AppState
{
  tunnels: Tunnel[] = [];
}
