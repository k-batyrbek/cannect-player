// Минимальный логгер main-процесса. Префикс + таймстамп.
// Позже сюда можно прикрутить файловый лог / ротацию.

export type LogLevel = 'info' | 'warn' | 'error'

export function log(level: LogLevel, message: string): void {
  const ts = new Date().toISOString()
  const line = `[${ts}] [${level.toUpperCase()}] ${message}`
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}
