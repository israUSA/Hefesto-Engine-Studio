import { Global, Module } from '@nestjs/common';
import { paths } from '../config/env';
import { dpapiCipher } from './dpapi';
import { SecretVault } from './secret-vault';

export const SECRET_VAULT = Symbol('SECRET_VAULT');

@Global()
@Module({
  providers: [
    {
      provide: SECRET_VAULT,
      useFactory: async () => {
        const vault = new SecretVault(paths.secrets(), dpapiCipher);
        await vault.load();
        return vault;
      },
    },
  ],
  exports: [SECRET_VAULT],
})
export class SecretsModule {}
