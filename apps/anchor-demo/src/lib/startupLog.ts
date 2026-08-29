/**
 * Startup milestone logging. Every milestone is tagged `[anchor:startup]` so
 * `adb logcat | grep "anchor:startup"` shows exactly where boot stalls — a
 * production blank screen must never be silent.
 */
type Level = 'INFO' | 'WARN' | 'ERROR';

const PREFIX = '[anchor:startup]';

export function consoleLog(level: Level, message: string): void {
  const line = `${PREFIX} ${message}`;
  if (level === 'ERROR') {
    console.error(line);
  } else if (level === 'WARN') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export function startupLog(message: string): void {
  consoleLog('INFO', message);
}
