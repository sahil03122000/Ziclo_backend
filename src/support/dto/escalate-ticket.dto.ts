import { ApiProperty } from '@nestjs/swagger';
import { TicketPriority } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsString } from 'class-validator';

export class EscalateTicketDto {
  @ApiProperty({ example: 'Customer is a VIP account — needs immediate attention' })
  @IsString()
  @IsNotEmpty()
  reason: string;

  @ApiProperty({
    enum: TicketPriority,
    description: 'Must be higher than the current ticket priority',
  })
  @IsEnum(TicketPriority)
  newPriority: TicketPriority;
}
