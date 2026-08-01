import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { Response } from 'express';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<{ url: string; ip?: string }>();

    // Don't double-send if response already started
    if (response.headersSent) return;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let errors: string[] = [];

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const raw = exception.getResponse();

      if (typeof raw === 'object' && raw !== null) {
        const body = raw as Record<string, unknown>;

        // Explicit errors array (from ValidationPipe exceptionFactory)
        if (
          Array.isArray(body.errors) &&
          (body.errors as unknown[]).length > 0
        ) {
          message = (body.message as string) || 'Validation failed';
          errors = body.errors as string[];
          this.logger.warn(`[ValidationError] ${errors.join(' | ')}`);
        }
        // Legacy: ValidationPipe may place messages as array in body.message
        else if (Array.isArray(body.message)) {
          message = 'Validation failed';
          errors = body.message as string[];
          this.logger.warn(`[ValidationError] ${errors.join(' | ')}`);
        } else {
          message = (body.message as string) ?? exception.message;
        }
      } else {
        message = exception.message;
      }
      if (process.env.NODE_ENV !== 'production') {
        this.logger.error(
          `[Stack] ${(exception as Error).stack ?? String(exception)}`,
        );
      }
    } else if (exception instanceof PrismaClientKnownRequestError) {
      const mapped = this.mapPrismaError(exception);
      status = mapped.status;
      message = mapped.message;
      this.logger.error(
        `[PrismaError] code=${exception.code} meta=${JSON.stringify(exception.meta)} msg=${exception.message}\n${exception.stack ?? ''}`,
      );
      // TEMPORARY — return the full Prisma error (code/meta/message) instead of the generic
      // mapped message while diagnosing the POST /bookings 500. Never do this in production.
      if (process.env.NODE_ENV !== 'production') {
        message = `[${exception.code}] ${exception.message}${exception.meta ? ` | meta=${JSON.stringify(exception.meta)}` : ''}`;
      }
    } else if (exception instanceof Error) {
      message = exception.message;
      this.logger.error(exception.stack);
    } else {
      this.logger.error('Unknown exception', exception);
    }

    response.status(status).json({
      success: false,
      statusCode: status,
      message,
      ...(errors.length > 0 && { errors }),
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }

  // Field -> exact friendly message for User/WorkerProfile global-uniqueness columns (see
  // DuplicateCheckService, which is the primary check — this is a defense-in-depth fallback
  // for races that slip past it and hit the DB unique index directly).
  private static readonly DUPLICATE_FIELD_MESSAGES: Record<string, string> = {
    email: 'Email already registered.',
    phone: 'Phone number already registered.',
    aadhaarNumber: 'Aadhaar number already registered.',
    panNumber: 'PAN number already registered.',
  };

  private mapPrismaError(error: PrismaClientKnownRequestError): {
    status: number;
    message: string;
  } {
    switch (error.code) {
      case 'P2002': {
        const target = error.meta?.target;
        const fields = Array.isArray(target) ? (target as string[]) : [];
        const knownField = fields.find(
          (f) => f in GlobalExceptionFilter.DUPLICATE_FIELD_MESSAGES,
        );
        if (knownField) {
          this.logger.warn(`[DuplicateField] P2002 on ${knownField}`);
          return {
            status: HttpStatus.BAD_REQUEST,
            message: GlobalExceptionFilter.DUPLICATE_FIELD_MESSAGES[knownField],
          };
        }
        const fieldList = fields.join(', ') || 'field';
        return {
          status: HttpStatus.CONFLICT,
          message: `A record with this ${fieldList} already exists`,
        };
      }
      case 'P2025':
        return { status: HttpStatus.NOT_FOUND, message: 'Record not found' };
      case 'P2003':
        return {
          status: HttpStatus.BAD_REQUEST,
          message: 'Related record not found',
        };
      case 'P2023':
        return { status: HttpStatus.BAD_REQUEST, message: 'Invalid ID format' };
      default:
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'A database error occurred',
        };
    }
  }
}
