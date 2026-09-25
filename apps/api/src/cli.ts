import 'reflect-metadata';
import { CommandFactory } from 'nest-commander';
import { CliModule } from './cli/cli.module';

async function bootstrap(): Promise<void> {
  await CommandFactory.run(CliModule, { logger: ['error', 'warn'] });
}

void bootstrap();
