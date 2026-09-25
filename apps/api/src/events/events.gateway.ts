import { OnModuleDestroy } from '@nestjs/common';
import { OnGatewayConnection, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Subscription } from 'rxjs';
import type { Server, WebSocket } from 'ws';
import { EventsService } from './events.service';

/** Broadcasts every ServerEvent as JSON on ws://host/ws. Clients only listen. */
@WebSocketGateway({ path: '/ws' })
export class EventsGateway implements OnGatewayConnection, OnModuleDestroy {
  @WebSocketServer() server!: Server;
  private readonly sub: Subscription;

  constructor(private readonly events: EventsService) {
    this.sub = this.events.events$.subscribe((event) => {
      if (!this.server) return;
      const data = JSON.stringify(event);
      for (const client of this.server.clients) {
        if (client.readyState === client.OPEN) client.send(data);
      }
    });
  }

  handleConnection(client: WebSocket): void {
    // Catch-up: the latest logs so the console isn't empty on connect.
    for (const entry of this.events.recentLogs({ limit: 200 })) {
      client.send(JSON.stringify({ type: 'log', entry }));
    }
  }

  onModuleDestroy(): void {
    this.sub.unsubscribe();
  }
}
