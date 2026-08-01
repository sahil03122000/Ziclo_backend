import { IsIn } from 'class-validator';

export class CollectPaymentDto {
  @IsIn(['qr', 'cash'])
  method: 'qr' | 'cash';
}
