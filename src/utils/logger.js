class Logger {
  constructor() {
    this.logLevel = process.env.LOG_LEVEL || 'info';
  }

  formatMessage(level, message, ...args) {
    const timestamp = new Date().toISOString();
    const formattedArgs = args.length > 0 ? ` ${args.join(' ')}` : '';
    return `[${timestamp}] [${level.toUpperCase()}] ${message}${formattedArgs}`;
  }

  info(message, ...args) {
    console.log(this.formatMessage('info', message, ...args));
  }

  warn(message, ...args) {
    console.warn(this.formatMessage('warn', message, ...args));
  }

  error(message, ...args) {
    console.error(this.formatMessage('error', message, ...args));
  }

  debug(message, ...args) {
    if (this.logLevel === 'debug') {
      console.log(this.formatMessage('debug', message, ...args));
    }
  }
}

export const logger = new Logger();