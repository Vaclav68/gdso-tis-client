/**
 * Utilitaires pour GDSO TIS Client
 * Retry, cache, helpers
 * @module lib/utils
 */

import { RETRY } from './config.js';
import { RetryExhaustedError, TimeoutError } from './errors.js';

// ============================================================================
// RETRY AVEC BACKOFF EXPONENTIEL
// ============================================================================

/**
 * Exécute une fonction avec retry et backoff exponentiel
 * @template T
 * @param {() => Promise<T>} fn - Fonction à exécuter
 * @param {Object} [options] - Options de retry
 * @param {number} [options.maxAttempts=3] - Nombre max de tentatives
 * @param {number} [options.delayMs=1000] - Délai initial en ms
 * @param {number} [options.backoffMultiplier=2] - Multiplicateur de backoff
 * @param {string} [options.operationName='operation'] - Nom pour les logs
 * @param {(error: Error) => boolean} [options.shouldRetry] - Fonction pour décider si retry
 * @param {(attempt: number, delay: number) => void} [options.onRetry] - Callback avant retry
 * @returns {Promise<T>}
 * @throws {RetryExhaustedError} Si toutes les tentatives échouent
 */
export async function withRetry(fn, options = {}) {
    const {
        maxAttempts = RETRY.maxAttempts,
        delayMs = RETRY.delayMs,
        backoffMultiplier = RETRY.backoffMultiplier,
        operationName = 'operation',
        shouldRetry = defaultShouldRetry,
        onRetry = null
    } = options;

    let lastError;
    let currentDelay = delayMs;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;

            // Vérifier si on doit retry
            if (attempt >= maxAttempts || !shouldRetry(error)) {
                break;
            }

            // Callback avant retry
            if (onRetry) {
                onRetry(attempt, currentDelay);
            }

            // Attendre avec backoff
            await sleep(currentDelay);
            currentDelay *= backoffMultiplier;
        }
    }

    throw new RetryExhaustedError(operationName, maxAttempts, lastError);
}

/**
 * Détermine si une erreur justifie un retry
 * @param {Error} error - Erreur à évaluer
 * @returns {boolean}
 */
function defaultShouldRetry(error) {
    // Ne pas retry les erreurs de parsing/validation
    if (error.code === 'SGTIN_PARSE_ERROR') return false;
    if (error.code === 'CREDENTIALS_MISSING') return false;

    // Retry les erreurs réseau/timeout
    if (error.name === 'TimeoutError') return true;
    if (error.code === 'ECONNRESET') return true;
    if (error.code === 'ENOTFOUND') return true;
    if (error.code === 'ETIMEDOUT') return true;

    // Retry les erreurs HTTP 5xx et 429
    const status = error.details?.httpStatus;
    if (status >= 500 || status === 429) return true;

    return false;
}

/**
 * Pause asynchrone
 * @param {number} ms - Durée en millisecondes
 * @returns {Promise<void>}
 */
export function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// CACHE LRU SIMPLE
// ============================================================================

/**
 * Cache LRU simple avec TTL
 * @template K, V
 */
export class LRUCache {
    /**
     * @param {Object} [options]
     * @param {number} [options.maxSize=100] - Taille max du cache
     * @param {number} [options.ttlMs=3600000] - TTL en ms (1h par défaut)
     */
    constructor(options = {}) {
        this.maxSize = options.maxSize || 100;
        this.ttlMs = options.ttlMs || 3600000; // 1 heure
        /** @type {Map<K, {value: V, expiry: number}>} */
        this.cache = new Map();
    }

    /**
     * Récupère une valeur du cache
     * @param {K} key - Clé
     * @returns {V|undefined}
     */
    get(key) {
        const entry = this.cache.get(key);
        if (!entry) return undefined;

        // Vérifier TTL
        if (Date.now() > entry.expiry) {
            this.cache.delete(key);
            return undefined;
        }

        // LRU: remettre en fin de Map
        this.cache.delete(key);
        this.cache.set(key, entry);

        return entry.value;
    }

    /**
     * Stocke une valeur dans le cache
     * @param {K} key - Clé
     * @param {V} value - Valeur
     * @param {number} [ttlMs] - TTL optionnel pour cette entrée
     */
    set(key, value, ttlMs = this.ttlMs) {
        // Supprimer si existe déjà
        this.cache.delete(key);

        // Éviction LRU si nécessaire
        while (this.cache.size >= this.maxSize) {
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }

        this.cache.set(key, {
            value,
            expiry: Date.now() + ttlMs
        });
    }

    /**
     * Vérifie si une clé existe et n'est pas expirée
     * @param {K} key - Clé
     * @returns {boolean}
     */
    has(key) {
        return this.get(key) !== undefined;
    }

    /**
     * Supprime une entrée
     * @param {K} key - Clé
     * @returns {boolean}
     */
    delete(key) {
        return this.cache.delete(key);
    }

    /**
     * Vide le cache
     */
    clear() {
        this.cache.clear();
    }

    /**
     * Taille actuelle du cache
     * @returns {number}
     */
    get size() {
        return this.cache.size;
    }

    /**
     * Statistiques du cache
     * @returns {Object}
     */
    stats() {
        let expired = 0;
        const now = Date.now();
        for (const entry of this.cache.values()) {
            if (now > entry.expiry) expired++;
        }
        return {
            size: this.cache.size,
            maxSize: this.maxSize,
            expired,
            ttlMs: this.ttlMs
        };
    }
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Formate une durée en texte lisible
 * @param {number} ms - Durée en millisecondes
 * @returns {string}
 */
export function formatDuration(ms) {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}min`;
}

/**
 * Parse sécurisé de JSON
 * @param {string} str - Chaîne JSON
 * @param {*} [defaultValue=null] - Valeur par défaut si échec
 * @returns {*}
 */
export function safeJsonParse(str, defaultValue = null) {
    try {
        return JSON.parse(str);
    } catch {
        return defaultValue;
    }
}

/**
 * Tronque une chaîne avec ellipsis
 * @param {string} str - Chaîne à tronquer
 * @param {number} maxLength - Longueur max
 * @returns {string}
 */
export function truncate(str, maxLength = 100) {
    if (!str || str.length <= maxLength) return str;
    return str.substring(0, maxLength - 3) + '...';
}

/**
 * Génère un ID unique simple
 * @returns {string}
 */
export function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 7);
}

export default {
    withRetry,
    sleep,
    LRUCache,
    formatDuration,
    safeJsonParse,
    truncate,
    generateId
};
