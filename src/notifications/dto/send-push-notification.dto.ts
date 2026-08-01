import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class SendPushNotificationDto {
  @ApiProperty({ description: 'Target user IDs to send the push notification to', type: [String], format: 'uuid' })
  @IsArray()
  @IsUUID('all', { each: true })
  userIds: string[];

  @ApiProperty({ example: 'Important Update' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({ example: 'Your service appointment has been confirmed.' })
  @IsString()
  @IsNotEmpty()
  message: string;

  @ApiPropertyOptional({ description: 'Extra key-value data payload forwarded to the app' })
  @IsOptional()
  data?: Record<string, unknown>;
}
