import { PartialType } from '@nestjs/swagger';

import { CreatePricingOptionDto } from './create-pricing-option.dto';

export class UpdatePricingOptionDto extends PartialType(CreatePricingOptionDto) {}
