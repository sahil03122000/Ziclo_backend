import { IsNotEmpty, IsString } from 'class-validator';

export class UpdatePdfMetadataDto {
  @IsString()
  @IsNotEmpty()
  pdfUrl: string;
}
