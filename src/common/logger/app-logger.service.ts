import { Injectable } from '@nestjs/common';
import type { LoggerService, LogLevel } from '@nestjs/common';

@Injectable()
export class AppLogger implements LoggerService {
  private readonly isDev = process.env.NODE_ENV !== 'production';

  private write(level: string, message: unknown, context?: string, trace?: string): void {
    const entry: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      level,
      context: context ?? 'App',
      message: typeof message === 'string' ? message : JSON.stringify(message),
      pid: process.pid,
    };
    if (trace) entry.trace = trace;

    const line = this.isDev
      ? `[${entry.timestamp}] [${String(level).toUpperCase()}] [${entry.context}] ${entry.message}${trace ? `\n${trace}` : ''}`
      : JSON.stringify(entry);

    if (level === 'error') {
      process.stderr.write(line + '\n');
    } else {
      process.stdout.write(line + '\n');
    }
  }

  log(message: unknown, context?: string): void {
    this.write('info', message, context);
  }

  error(message: unknown, trace?: string, context?: string): void {
    this.write('error', message, context, trace);
  }

  warn(message: unknown, context?: string): void {
    this.write('warn', message, context);
  }

  debug(message: unknown, context?: string): void {
    if (this.isDev) this.write('debug', message, context);
  }

  verbose(message: unknown, context?: string): void {
    if (this.isDev) this.write('verbose', message, context);
  }

  setLogLevels(_levels: LogLevel[]): void {}
}
