import { PartialType } from '@nestjs/swagger';

import { CreatePropertyTypeDto } from './create-property-type.dto';

export class UpdatePropertyTypeDto extends PartialType(CreatePropertyTypeDto) {}
