import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, unknown> {
  intercept(_ctx: ExecutionContext, next: CallHandler<T>): Observable<unknown> {
    return next.handle().pipe(
      map((data) => {
        // Already in standard format — pass through unchanged
        if (data !== null && typeof data === 'object' && 'success' in (data as object)) {
          return data;
        }
        // Wrap bare values
        return { success: true, data };
      }),
    );
  }
}
