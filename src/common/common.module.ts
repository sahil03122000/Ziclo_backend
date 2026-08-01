import { Global, Module } from '@nestjs/common';

import { DuplicateCheckService } from './services/duplicate-check.service';

@Global()
@Module({
  providers: [DuplicateCheckService],
  exports: [DuplicateCheckService],
})
export class CommonModule {}
