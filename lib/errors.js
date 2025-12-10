/**
 * Classes d'erreur personnalisées pour GDSO TIS Client
 * Permet une gestion d'erreur plus fine et des messages explicites
 * @module lib/errors
 */

/**
 * Erreur de base GDSO
 * @extends Error
 */
export class GdsoError extends Error {
    /**
     * @param {string} message - Message d'erreur
     * @param {string} code - Code d'erreur unique
     * @param {Object} [details] - Détails supplémentaires
     */
    constructor(message, code, details = {}) {
        super(message);
        this.name = 'GdsoError';
        this.code = code;
        this.details = details;
        this.timestamp = new Date().toISOString();
    }

    /**
     * Sérialise l'erreur en objet JSON
     * @returns {Object}
     */
    toJSON() {
        return {
            name: this.name,
            code: this.code,
            message: this.message,
            details: this.details,
            timestamp: this.timestamp
        };
    }
}

/**
 * Erreur de parsing SGTIN
 * @extends GdsoError
 */
export class SgtinParseError extends GdsoError {
    /**
     * @param {string} sgtin - SGTIN invalide
     * @param {string} [reason] - Raison de l'échec
     */
    constructor(sgtin, reason = 'Format invalide') {
        super(
            `Format SGTIN invalide: ${sgtin} - ${reason}`,
            'SGTIN_PARSE_ERROR',
            { sgtin, reason }
        );
        this.name = 'SgtinParseError';
    }
}

/**
 * Erreur de résolution DNS/ONS
 * @extends GdsoError
 */
export class DnsResolutionError extends GdsoError {
    /**
     * @param {string} fqdn - FQDN interrogé
     * @param {string} reason - Raison de l'échec
     * @param {number} [status] - Code HTTP si applicable
     */
    constructor(fqdn, reason, status = null) {
        super(
            `Résolution DNS échouée pour ${fqdn}: ${reason}`,
            'DNS_RESOLUTION_ERROR',
            { fqdn, reason, httpStatus: status }
        );
        this.name = 'DnsResolutionError';
    }
}

/**
 * Erreur quand aucun enregistrement NAPTR n'est trouvé
 * @extends DnsResolutionError
 */
export class NaptrNotFoundError extends DnsResolutionError {
    /**
     * @param {string} fqdn - FQDN interrogé
     * @param {string} gtin - GTIN-13 associé
     */
    constructor(fqdn, gtin) {
        super(fqdn, 'Aucun enregistrement NAPTR trouvé - Le fabricant n\'a peut-être pas configuré son API GDSO');
        this.name = 'NaptrNotFoundError';
        this.code = 'NAPTR_NOT_FOUND';
        this.details.gtin = gtin;
    }
}

/**
 * Erreur d'authentification GDSO
 * @extends GdsoError
 */
export class AuthenticationError extends GdsoError {
    /**
     * @param {string} reason - Raison de l'échec
     * @param {number} [status] - Code HTTP
     * @param {string} [environment] - Environnement (testing/production)
     */
    constructor(reason, status = null, environment = null) {
        super(
            `Authentification échouée: ${reason}`,
            'AUTH_ERROR',
            { reason, httpStatus: status, environment }
        );
        this.name = 'AuthenticationError';
    }
}

/**
 * Erreur de credentials manquants
 * @extends AuthenticationError
 */
export class CredentialsMissingError extends AuthenticationError {
    /**
     * @param {string} environment - Environnement concerné
     */
    constructor(environment) {
        const envVars = environment === 'production'
            ? 'GDSO_PROD_USERNAME/GDSO_PROD_PASSWORD'
            : 'GDSO_USERNAME/GDSO_PASSWORD';
        super(`Credentials manquants pour ${environment}. Définir ${envVars} dans .env`, null, environment);
        this.name = 'CredentialsMissingError';
        this.code = 'CREDENTIALS_MISSING';
    }
}

/**
 * Erreur d'appel API fabricant
 * @extends GdsoError
 */
export class ManufacturerApiError extends GdsoError {
    /**
     * @param {string} manufacturer - Nom du fabricant
     * @param {string} reason - Raison de l'échec
     * @param {number} [status] - Code HTTP
     * @param {string} [url] - URL appelée
     */
    constructor(manufacturer, reason, status = null, url = null) {
        super(
            `API ${manufacturer} - Erreur: ${reason}`,
            'MANUFACTURER_API_ERROR',
            { manufacturer, reason, httpStatus: status, url }
        );
        this.name = 'ManufacturerApiError';
    }
}

/**
 * Erreur quand le pneu n'est pas trouvé
 * @extends ManufacturerApiError
 */
export class TireNotFoundError extends ManufacturerApiError {
    /**
     * @param {string} sgtin - SGTIN du pneu
     * @param {string} manufacturer - Fabricant
     */
    constructor(sgtin, manufacturer) {
        super(manufacturer, `Pneu non trouvé: ${sgtin}`, 404);
        this.name = 'TireNotFoundError';
        this.code = 'TIRE_NOT_FOUND';
        this.details.sgtin = sgtin;
    }
}

/**
 * Erreur de timeout
 * @extends GdsoError
 */
export class TimeoutError extends GdsoError {
    /**
     * @param {string} operation - Opération en timeout
     * @param {number} timeoutMs - Timeout en ms
     */
    constructor(operation, timeoutMs) {
        super(
            `Timeout après ${timeoutMs}ms pour: ${operation}`,
            'TIMEOUT_ERROR',
            { operation, timeoutMs }
        );
        this.name = 'TimeoutError';
    }
}

/**
 * Erreur après épuisement des retries
 * @extends GdsoError
 */
export class RetryExhaustedError extends GdsoError {
    /**
     * @param {string} operation - Opération échouée
     * @param {number} attempts - Nombre de tentatives
     * @param {Error} lastError - Dernière erreur
     */
    constructor(operation, attempts, lastError) {
        super(
            `Échec après ${attempts} tentatives: ${operation}`,
            'RETRY_EXHAUSTED',
            {
                operation,
                attempts,
                lastError: lastError?.message || String(lastError)
            }
        );
        this.name = 'RetryExhaustedError';
        this.lastError = lastError;
    }
}

export default {
    GdsoError,
    SgtinParseError,
    DnsResolutionError,
    NaptrNotFoundError,
    AuthenticationError,
    CredentialsMissingError,
    ManufacturerApiError,
    TireNotFoundError,
    TimeoutError,
    RetryExhaustedError
};
