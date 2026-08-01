import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsArray, IsOptional, IsUUID } from 'class-validator';

export class ManagerAreaQueryDto {
  @ApiPropertyOptional({
    type: String,
    description:
      'Comma-separated Office Location UUIDs to filter by — must belong to the logged-in ' +
      "manager. Office ids that don't belong to the manager are silently dropped. Omit to " +
      "return areas for all of the manager's own offices (union).",
    example:
      'a1b2c3d4-e5f6-7890-abcd-ef1234567890,b2c3d4e5-f6a7-8901-bcde-f12345678901',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }): unknown => {
    if (Array.isArray(value)) return value;
    if (typeof value !== 'string') return value;
    return value
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
  })
  @IsArray()
  @IsUUID('4', { each: true })
  officeLocationIds?: string[];
}
