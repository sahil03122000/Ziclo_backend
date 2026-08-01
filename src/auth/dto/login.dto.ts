import { IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export enum Platform {
  MOBILE = 'MOBILE',
  WEB = 'WEB',
}

export class LoginDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  password: string;

  @IsOptional()
  @IsEnum(Platform)
  platform?: Platform = Platform.MOBILE;
}