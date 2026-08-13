import { registerDecorator, ValidationArguments, ValidationOptions } from 'class-validator';

// Exact-age calculation (not a flat 365*18-day check) — accounts for leap years and whether
// the birthday has actually occurred yet this year, so e.g. someone born 18 years ago tomorrow
// still correctly fails today. Also rejects any DOB in the future outright.
function isAtLeastAge(dob: Date, minAge: number): boolean {
  const now = new Date();
  if (dob > now) return false;

  let age = now.getFullYear() - dob.getFullYear();
  const monthDiff = now.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate())) {
    age--;
  }
  return age >= minAge;
}

export function IsAdult(minAge = 18, validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isAdult',
      target: object.constructor,
      propertyName,
      constraints: [minAge],
      options: validationOptions,
      validator: {
        validate(value: unknown, args: ValidationArguments): boolean {
          if (value === undefined || value === null || value === '') return true; // @IsOptional handles required-ness
          const dob = value instanceof Date ? value : new Date(value as string);
          if (isNaN(dob.getTime())) return false; // @IsDateString already reports format errors
          const [min] = args.constraints as [number];
          return isAtLeastAge(dob, min);
        },
        defaultMessage(): string {
          return 'Minimum age must be 18 years.';
        },
      },
    });
  };
}
