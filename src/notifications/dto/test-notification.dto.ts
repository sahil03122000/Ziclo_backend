import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class TestNotificationDto {
  @ApiProperty({ example: 'Test Push Notification' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({ example: 'This is a test message to verify FCM delivery.' })
  @IsString()
  @IsNotEmpty()
  message: string;

  @ApiPropertyOptional({
    description: 'Target user ID — ADMIN only; omit to send to yourself',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  userId?: string;
}
