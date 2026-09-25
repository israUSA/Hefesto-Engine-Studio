import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WsAdapter } from '@nestjs/platform-ws';
import { AppModule } from './app/app.module';
import { env } from './config/env';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.useWebSocketAdapter(new WsAdapter(app));
  // Only the local UI (Angular dev server or Electron) talks to the API.
  app.enableCors({ origin: [/^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/] });
  app.enableShutdownHooks();

  const port = Number(process.env['PORT'] ?? 3000);
  // Bind to loopback only: the API holds decrypted keys in memory.
  await app.listen(port, '127.0.0.1');
  Logger.log(`Hefesto API en http://127.0.0.1:${port}/api · HEFESTO_HOME=${env.home}`);
}

void bootstrap();
