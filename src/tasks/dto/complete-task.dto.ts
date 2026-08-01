import { IsNotEmpty, IsString, IsUrl } from 'class-validator';

export class CompleteTaskDto {
  @IsNotEmpty()
  @IsUrl()
  beforeImageUrl: string;

  @IsNotEmpty()
  @IsUrl()
  afterImageUrl: string;

  @IsNotEmpty()
  @IsString()
  completionNote: string;
}
