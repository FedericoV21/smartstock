import { IsString, MinLength } from 'class-validator';

export class NexusLoginDto {
  @IsString()
  @MinLength(1)
  password!: string;
}
