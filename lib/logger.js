/**
 * Logger structuré pour GDSO TIS Client
 * Supporte les formats console (humain) et JSON (machine)
 * @module lib/logger
 */

/**
 * Niveaux de log
 * @enum {number}
 */
export const LogLevel = {
    DEBUG: 0,
    INFO: 1,
    SUCCESS: 2,
    WARN: 3,
    ERROR: 4,
    SILENT: 5
};

/**
 * Noms des niveaux
 * @type {Object<number, string>}
 */
const LEVEL_NAMES = {
    [LogLevel.DEBUG]: 'debug',
    [LogLevel.INFO]: 'info',
    [LogLevel.SUCCESS]: 'success',
    [LogLevel.WARN]: 'warn',
    [LogLevel.ERROR]: 'error'
};

/**
 * Préfixes console par niveau
 * @type {Object<number, string>}
 */
const CONSOLE_PREFIX = {
    [LogLevel.DEBUG]: '🔍',
    [LogLevel.INFO]: '  ',
    [LogLevel.SUCCESS]: '✅',
    [LogLevel.WARN]: '⚠️',
    [LogLevel.ERROR]: '❌'
};

/**
 * Couleurs ANSI pour terminal
 */
const COLORS = {
    reset: '\x1b[0m',
    dim: '\x1b[2m',
    cyan: '\x1b[36m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    gray: '\x1b[90m'
};

/**
 * Logger structuré
 */
export class Logger {
    /**
     * @param {Object} [options]
     * @param {number} [options.level=LogLevel.INFO] - Niveau minimum de log
     * @param {boolean} [options.json=false] - Format JSON
     * @param {boolean} [options.colors=true] - Couleurs ANSI
     * @param {boolean} [options.timestamps=false] - Afficher timestamps
     * @param {string} [options.context] - Contexte (ex: 'ONS', 'Auth')
     */
    constructor(options = {}) {
        this.level = options.level ?? LogLevel.INFO;
        this.json = options.json ?? false;
        this.colors = options.colors ?? true;
        this.timestamps = options.timestamps ?? false;
        this.context = options.context || null;
    }

    /**
     * Crée un logger enfant avec contexte
     * @param {string} context - Contexte
     * @returns {Logger}
     */
    child(context) {
        return new Logger({
            level: this.level,
            json: this.json,
            colors: this.colors,
            timestamps: this.timestamps,
            context: this.context ? `${this.context}:${context}` : context
        });
    }

    /**
     * Log un message
     * @param {number} level - Niveau
     * @param {string} message - Message
     * @param {Object} [data] - Données additionnelles
     */
    log(level, message, data = {}) {
        if (level < this.level) return;

        if (this.json) {
            this._logJson(level, message, data);
        } else {
            this._logConsole(level, message, data);
        }
    }

    /**
     * Log format JSON
     * @private
     */
    _logJson(level, message, data) {
        const entry = {
            timestamp: new Date().toISOString(),
            level: LEVEL_NAMES[level],
            message,
            ...data
        };

        if (this.context) {
            entry.context = this.context;
        }

        console.log(JSON.stringify(entry));
    }

    /**
     * Log format console
     * @private
     */
    _logConsole(level, message, data) {
        const prefix = CONSOLE_PREFIX[level];
        let output = `${prefix} ${message}`;

        // Ajouter timestamp si demandé
        if (this.timestamps) {
            const time = new Date().toISOString().substring(11, 19);
            output = this.colors
                ? `${COLORS.gray}[${time}]${COLORS.reset} ${output}`
                : `[${time}] ${output}`;
        }

        // Ajouter contexte si présent
        if (this.context) {
            output = this.colors
                ? `${COLORS.cyan}[${this.context}]${COLORS.reset} ${output}`
                : `[${this.context}] ${output}`;
        }

        // Coloriser selon le niveau
        if (this.colors) {
            switch (level) {
                case LogLevel.SUCCESS:
                    output = `${COLORS.green}${output}${COLORS.reset}`;
                    break;
                case LogLevel.WARN:
                    output = `${COLORS.yellow}${output}${COLORS.reset}`;
                    break;
                case LogLevel.ERROR:
                    output = `${COLORS.red}${output}${COLORS.reset}`;
                    break;
                case LogLevel.DEBUG:
                    output = `${COLORS.dim}${output}${COLORS.reset}`;
                    break;
            }
        }

        // Afficher les données additionnelles
        if (Object.keys(data).length > 0) {
            const dataStr = this.colors
                ? `${COLORS.gray}${JSON.stringify(data)}${COLORS.reset}`
                : JSON.stringify(data);
            output += ` ${dataStr}`;
        }

        console.log(output);
    }

    // Méthodes de convenance

    /**
     * Log debug
     * @param {string} message
     * @param {Object} [data]
     */
    debug(message, data) {
        this.log(LogLevel.DEBUG, message, data);
    }

    /**
     * Log info
     * @param {string} message
     * @param {Object} [data]
     */
    info(message, data) {
        this.log(LogLevel.INFO, message, data);
    }

    /**
     * Log success
     * @param {string} message
     * @param {Object} [data]
     */
    success(message, data) {
        this.log(LogLevel.SUCCESS, message, data);
    }

    /**
     * Log warning
     * @param {string} message
     * @param {Object} [data]
     */
    warn(message, data) {
        this.log(LogLevel.WARN, message, data);
    }

    /**
     * Log error
     * @param {string} message
     * @param {Object} [data]
     */
    error(message, data) {
        this.log(LogLevel.ERROR, message, data);
    }

    /**
     * Log une section/bannière
     * @param {string} title - Titre de la section
     */
    section(title) {
        if (this.json) {
            this.info(`=== ${title} ===`);
        } else {
            console.log(`\n╭─────────────────────────────────────────────────────────╮`);
            console.log(`│  ${title.padEnd(55)}│`);
            console.log(`╰─────────────────────────────────────────────────────────╯`);
        }
    }

    /**
     * Log un tableau de données
     * @param {Array<Object>} data - Données
     * @param {Array<string>} columns - Colonnes à afficher
     */
    table(data, columns) {
        if (this.json) {
            this.info('table', { data, columns });
        } else {
            console.table(data, columns);
        }
    }
}

/**
 * Instance par défaut du logger
 */
export const logger = new Logger();

export default Logger;
