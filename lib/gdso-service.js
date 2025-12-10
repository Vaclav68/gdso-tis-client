/**
 * Service GDSO TIS - Module principal
 * Architecture scalable pour tous les fabricants
 *
 * @module lib/gdso-service
 * @author Ralph Achatz
 * @version 2.0.0
 */

import { getEnvironmentConfig, TIMEOUTS } from './config.js';
import { getManufacturerConfig, buildApiUrl, buildAllPossibleUrls } from './manufacturers.js';
import { withRetry, LRUCache } from './utils.js';
import { Logger, LogLevel } from './logger.js';
import {
    SgtinParseError,
    DnsResolutionError,
    NaptrNotFoundError,
    AuthenticationError,
    CredentialsMissingError,
    ManufacturerApiError,
    TireNotFoundError
} from './errors.js';

/**
 * @typedef {Object} ParsedSgtin
 * @property {string} companyPrefix - Préfixe entreprise GS1
 * @property {string} indicatorItemRef - Indicateur + référence article
 * @property {string} serialNumber - Numéro de série unique
 * @property {string} urn - URN SGTIN complète
 */

/**
 * @typedef {Object} OnsResult
 * @property {ParsedSgtin} parsed - SGTIN parsé
 * @property {string} gtin13 - GTIN-13 calculé
 * @property {string} fqdn - FQDN pour résolution DNS
 * @property {Object} manufacturer - Config fabricant
 * @property {string} apiUrl - URL de l'API fabricant
 * @property {Array<{service: string, url: string}>} services - Services NAPTR trouvés
 */

/**
 * @typedef {Object} TireResult
 * @property {string} sgtin - SGTIN original
 * @property {string} manufacturer - Nom du fabricant
 * @property {string} gtin13 - GTIN-13
 * @property {string} apiUrl - URL API utilisée
 * @property {Object|null} data - Données du pneu ou null
 */

/**
 * @typedef {Object} GdsoServiceOptions
 * @property {string} [environment='testing'] - Environnement (testing/production)
 * @property {string} [username] - Username GDSO (override .env)
 * @property {string} [password] - Password GDSO (override .env)
 * @property {boolean} [verbose=true] - Activer les logs
 * @property {boolean} [jsonLogs=false] - Format JSON pour les logs
 * @property {boolean} [useCache=true] - Activer le cache ONS
 * @property {number} [cacheTtlMs=3600000] - TTL du cache (1h par défaut)
 */

/**
 * Classe principale du service GDSO
 */
export class GdsoService {
    /**
     * Crée une instance du service GDSO
     * @param {GdsoServiceOptions} [options={}] - Options de configuration
     */
    constructor(options = {}) {
        this.env = options.environment || 'testing';
        this.config = getEnvironmentConfig(this.env);

        // Sélectionner les credentials selon l'environnement
        const isProd = this.env === 'production';
        this.credentials = {
            username: options.username || (isProd ? process.env.GDSO_PROD_USERNAME : process.env.GDSO_USERNAME),
            password: options.password || (isProd ? process.env.GDSO_PROD_PASSWORD : process.env.GDSO_PASSWORD)
        };

        // Token JWT
        /** @type {string|null} */
        this.token = null;
        /** @type {number|null} */
        this.tokenExpiry = null;

        // Logger
        this.logger = new Logger({
            level: options.verbose === false ? LogLevel.SILENT : LogLevel.INFO,
            json: options.jsonLogs || false,
            colors: !options.jsonLogs
        });

        // Cache ONS (GTIN-13 → OnsResult)
        this.useCache = options.useCache !== false;
        this.onsCache = new LRUCache({
            maxSize: 500,
            ttlMs: options.cacheTtlMs || 3600000 // 1 heure
        });
    }

    // ========================================================================
    // SGTIN PARSING
    // ========================================================================

    /**
     * Parse une URN SGTIN-96
     * @param {string} sgtinUrn - URN au format urn:epc:id:sgtin:prefix.itemref.serial
     * @returns {ParsedSgtin}
     * @throws {SgtinParseError} Si le format est invalide
     */
    parseSgtin(sgtinUrn) {
        if (!sgtinUrn || typeof sgtinUrn !== 'string') {
            throw new SgtinParseError(String(sgtinUrn), 'SGTIN doit être une chaîne non vide');
        }

        const regex = /^urn:epc:id:sgtin:(\d+)\.(\d+)\.(\d+)$/;
        const match = sgtinUrn.match(regex);

        if (!match) {
            throw new SgtinParseError(sgtinUrn, 'Format attendu: urn:epc:id:sgtin:<prefix>.<itemref>.<serial>');
        }

        const [, companyPrefix, indicatorItemRef, serialNumber] = match;
        return { companyPrefix, indicatorItemRef, serialNumber, urn: sgtinUrn };
    }

    /**
     * Calcule le check digit GS1 (Modulo 10)
     * @param {string} digits - Chaîne de chiffres
     * @returns {number} Check digit (0-9)
     */
    calculateCheckDigit(digits) {
        let sum = 0;
        for (let i = 0; i < digits.length; i++) {
            const multiplier = (digits.length - i) % 2 === 0 ? 1 : 3;
            sum += parseInt(digits[i], 10) * multiplier;
        }
        return (10 - (sum % 10)) % 10;
    }

    /**
     * Convertit un SGTIN parsé en GTIN-13
     * @param {ParsedSgtin} parsed - SGTIN parsé
     * @returns {string} GTIN-13
     */
    sgtinToGtin13(parsed) {
        const indicator = parsed.indicatorItemRef[0];
        const itemRef = parsed.indicatorItemRef.substring(1);
        const gtin14Base = indicator + parsed.companyPrefix + itemRef;
        const checkDigit = this.calculateCheckDigit(gtin14Base);
        return (gtin14Base + checkDigit).substring(1); // GTIN-13 = GTIN-14 sans premier chiffre
    }

    /**
     * Convertit un GTIN-13 en FQDN pour résolution ONS
     * @param {string} gtin - GTIN-13
     * @returns {string} FQDN (ex: 0.9.2.2.8.8.9.9.9.6.6.8.0.gtin.gs1.id.gdso.org)
     */
    gtinToFqdn(gtin) {
        const reversed = gtin.split('').reverse().join('.');
        return `${reversed}.${this.config.ons.suffix}`;
    }

    // ========================================================================
    // ONS RESOLUTION
    // ========================================================================

    /**
     * Résout l'ONS pour obtenir l'URL de l'API fabricant
     * @param {string} sgtinUrn - URN SGTIN
     * @returns {Promise<OnsResult>}
     * @throws {SgtinParseError} Si format SGTIN invalide
     * @throws {DnsResolutionError} Si erreur DNS
     * @throws {NaptrNotFoundError} Si pas d'enregistrement NAPTR
     */
    async resolveOns(sgtinUrn) {
        const parsed = this.parseSgtin(sgtinUrn);
        const gtin13 = this.sgtinToGtin13(parsed);

        // Vérifier le cache
        if (this.useCache) {
            const cached = this.onsCache.get(gtin13);
            if (cached) {
                this.logger.debug(`Cache hit pour GTIN-13: ${gtin13}`);
                return { ...cached, parsed };
            }
        }

        const fqdn = this.gtinToFqdn(gtin13);
        const manufacturer = getManufacturerConfig(parsed.companyPrefix);

        this.logger.info(`Fabricant détecté: ${manufacturer.name} (${parsed.companyPrefix})`);
        this.logger.info(`GTIN-13: ${gtin13}`);
        this.logger.debug(`FQDN: ${fqdn}`);

        // Résolution DNS avec retry
        const url = `${this.config.ons.dnsResolver}?name=${encodeURIComponent(fqdn)}&type=NAPTR`;

        const data = await withRetry(
            async () => {
                const response = await fetch(url, {
                    headers: { 'Accept': 'application/dns-json' },
                    signal: AbortSignal.timeout(TIMEOUTS.dns)
                });

                if (!response.ok) {
                    throw new DnsResolutionError(fqdn, `HTTP ${response.status}`, response.status);
                }

                return response.json();
            },
            {
                operationName: `DNS resolution ${fqdn}`,
                onRetry: (attempt, delay) => {
                    this.logger.warn(`Retry DNS ${attempt}, attente ${delay}ms...`);
                }
            }
        );

        if (data.Status !== 0 || !data.Answer?.length) {
            throw new NaptrNotFoundError(fqdn, gtin13);
        }

        // Parser les services NAPTR
        const services = [];
        for (const record of data.Answer) {
            const match = record.data.match(/^\d+\s+\d+\s+\S+\s+(\S+)\s+(!.*!)\s+\S+$/);
            if (match) {
                const urlMatch = match[2].match(/!.*!(https?:\/\/[^!]+)!/);
                if (urlMatch) {
                    services.push({ service: match[1], url: urlMatch[1] });
                }
            }
        }

        const apiService = services.find(s => s.service.includes('GetTireBySgtin'));
        if (!apiService) {
            throw new NaptrNotFoundError(fqdn, gtin13);
        }

        const result = {
            parsed,
            gtin13,
            fqdn,
            manufacturer,
            apiUrl: apiService.url,
            services
        };

        // Mettre en cache (sans parsed qui est spécifique à chaque UII)
        if (this.useCache) {
            const { parsed: _, ...cacheData } = result;
            this.onsCache.set(gtin13, cacheData);
        }

        return result;
    }

    // ========================================================================
    // AUTHENTICATION
    // ========================================================================

    /**
     * Authentification GDSO (Basic Auth → JWT)
     * @returns {Promise<string>} Token JWT
     * @throws {CredentialsMissingError} Si credentials absents
     * @throws {AuthenticationError} Si authentification échoue
     */
    async authenticate() {
        // Réutiliser le token s'il est encore valide (avec marge de 60s)
        if (this.token && this.tokenExpiry && Date.now() < this.tokenExpiry - 60000) {
            this.logger.debug('Réutilisation du token existant');
            return this.token;
        }

        if (!this.credentials.username || !this.credentials.password) {
            throw new CredentialsMissingError(this.env);
        }

        const basicAuth = Buffer.from(
            `${this.credentials.username}:${this.credentials.password}`
        ).toString('base64');

        this.logger.info(`Authentification sur ${this.config.auth.tokenUrl}...`);

        const response = await withRetry(
            async () => {
                const res = await fetch(this.config.auth.tokenUrl, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Basic ${basicAuth}`,
                        'Accept': 'application/json',
                        'Content-Type': 'application/json'
                    },
                    signal: AbortSignal.timeout(TIMEOUTS.auth)
                });

                if (!res.ok) {
                    const text = await res.text();
                    throw new AuthenticationError(
                        text.substring(0, 100),
                        res.status,
                        this.env
                    );
                }

                return res;
            },
            {
                operationName: 'Authentication',
                onRetry: (attempt, delay) => {
                    this.logger.warn(`Retry auth ${attempt}, attente ${delay}ms...`);
                }
            }
        );

        const tokenText = await response.text();

        // Le token est retourné directement en JWT
        if (tokenText.startsWith('eyJ')) {
            this.token = tokenText.trim();

            // Extraire l'expiration du JWT
            try {
                const payload = JSON.parse(Buffer.from(this.token.split('.')[1], 'base64').toString());
                this.tokenExpiry = payload.exp * 1000;
                this.logger.success(`Token obtenu (expire: ${new Date(this.tokenExpiry).toLocaleString()})`);
            } catch {
                this.tokenExpiry = Date.now() + 3600000; // 1h par défaut
                this.logger.success('Token obtenu');
            }

            return this.token;
        }

        // Sinon parser comme JSON
        const data = JSON.parse(tokenText);
        this.token = data.AccessToken || data.access_token || data.IdToken;

        if (!this.token) {
            throw new AuthenticationError('Pas de token dans la réponse', null, this.env);
        }

        this.tokenExpiry = Date.now() + (data.expires_in || 3600) * 1000;
        this.logger.success('Token obtenu');
        return this.token;
    }

    // ========================================================================
    // API CALL
    // ========================================================================

    /**
     * Appelle l'API du fabricant pour un pneu
     * @param {string} apiUrl - URL de base de l'API
     * @param {string} sgtin - URN SGTIN du pneu
     * @param {Object} manufacturer - Config du fabricant
     * @returns {Promise<Object|null>} Données du pneu ou null
     */
    async callManufacturerApi(apiUrl, sgtin, manufacturer) {
        const token = await this.authenticate();

        // Construire les URLs à essayer selon le fabricant
        let urls;
        if (manufacturer.urlPatterns) {
            urls = buildAllPossibleUrls(apiUrl, sgtin, manufacturer);
        } else {
            urls = [buildApiUrl(apiUrl, sgtin, manufacturer)];
            // Ajouter aussi la variante opposée d'encodage
            const altConfig = { ...manufacturer, encodeSgtin: !manufacturer.encodeSgtin };
            urls.push(buildApiUrl(apiUrl, sgtin, altConfig));
        }

        // Dédupliquer
        urls = [...new Set(urls)];

        this.logger.info(`Appel API ${manufacturer.name}...`);

        for (const url of urls) {
            try {
                this.logger.debug(`Tentative: ${url}`);

                const response = await fetch(url, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Accept': 'application/json',
                        ...manufacturer.headers
                    },
                    signal: AbortSignal.timeout(TIMEOUTS.api)
                });

                if (response.ok) {
                    const data = await response.json();
                    this.logger.success('Données reçues!');

                    // Appliquer transformation si définie
                    return manufacturer.transformResponse
                        ? manufacturer.transformResponse(data)
                        : data;
                }

                if (response.status === 404) {
                    this.logger.warn(`Pneu non trouvé sur cette URL`);
                    continue;
                }

                this.logger.warn(`${response.status} ${response.statusText}`);

            } catch (error) {
                this.logger.warn(`Erreur: ${error.message}`);
            }
        }

        return null;
    }

    /**
     * Appelle l'API batch du fabricant
     * @param {string} apiUrl - URL de base de l'API
     * @param {Array<string>} sgtins - Liste des URN SGTIN
     * @param {Object} manufacturer - Config du fabricant
     * @returns {Promise<Array|null>} Données des pneus ou null
     */
    async callBatchApi(apiUrl, sgtins, manufacturer) {
        const token = await this.authenticate();

        // Construire l'URL batch
        const baseUrl = apiUrl.endsWith('/') ? apiUrl.slice(0, -1) : apiUrl;
        const batchUrls = [
            baseUrl.replace(/\/tire\/?$/, '/tires'),
            baseUrl.replace(/\/tire\/?$/, ''),
            baseUrl + 's',
            baseUrl
        ];

        this.logger.info(`Appel Batch API ${manufacturer.name} (${sgtins.length} UIIs)...`);

        for (const url of [...new Set(batchUrls)]) {
            try {
                this.logger.debug(`POST ${url}`);

                const response = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Accept': 'application/json',
                        'Content-Type': 'application/json',
                        ...manufacturer.headers
                    },
                    body: JSON.stringify(sgtins),
                    signal: AbortSignal.timeout(TIMEOUTS.api)
                });

                if (response.ok) {
                    const data = await response.json();
                    this.logger.success(`${Array.isArray(data) ? data.length : 1} résultat(s)`);
                    return data;
                }

                this.logger.warn(`${response.status} ${response.statusText}`);

            } catch (error) {
                this.logger.warn(`Erreur: ${error.message}`);
            }
        }

        return null;
    }

    // ========================================================================
    // MAIN METHODS
    // ========================================================================

    /**
     * Récupère les informations d'un pneu
     * @param {string} sgtinUrn - URN SGTIN du pneu
     * @returns {Promise<TireResult>}
     */
    async getTireInfo(sgtinUrn) {
        // 1. Résolution ONS
        this.logger.section('RÉSOLUTION ONS');
        const ons = await this.resolveOns(sgtinUrn);

        // 2. Appel API fabricant (authentification implicite)
        this.logger.section('APPEL API FABRICANT');
        const tireData = await this.callManufacturerApi(
            ons.apiUrl,
            sgtinUrn,
            ons.manufacturer
        );

        return {
            sgtin: sgtinUrn,
            manufacturer: ons.manufacturer.name,
            gtin13: ons.gtin13,
            apiUrl: ons.apiUrl,
            data: tireData
        };
    }

    /**
     * Récupère les informations de plusieurs pneus (batch)
     * Regroupe automatiquement par fabricant pour optimiser
     * @param {Array<string>} sgtinUrns - Liste des URN SGTIN
     * @returns {Promise<Array<TireResult>>}
     */
    async getTireInfoBatch(sgtinUrns) {
        // Grouper par company prefix (fabricant)
        /** @type {Object<string, Array<string>>} */
        const groups = {};

        for (const sgtin of sgtinUrns) {
            const parsed = this.parseSgtin(sgtin);
            if (!groups[parsed.companyPrefix]) {
                groups[parsed.companyPrefix] = [];
            }
            groups[parsed.companyPrefix].push(sgtin);
        }

        this.logger.info(`Batch: ${sgtinUrns.length} UIIs, ${Object.keys(groups).length} fabricant(s)`);

        /** @type {Array<TireResult>} */
        const results = [];

        for (const [prefix, sgtins] of Object.entries(groups)) {
            this.logger.section(`GROUPE ${prefix} (${sgtins.length} UIIs)`);

            // Résolution ONS pour un UII du groupe (les autres ont le même GTIN)
            const ons = await this.resolveOns(sgtins[0]);

            if (sgtins.length > 1) {
                // Diviser en lots de 100 max (limite API GDSO)
                for (let i = 0; i < sgtins.length; i += 100) {
                    const batch = sgtins.slice(i, i + 100);
                    const batchData = await this.callBatchApi(ons.apiUrl, batch, ons.manufacturer);

                    if (batchData && Array.isArray(batchData)) {
                        for (const item of batchData) {
                            results.push({
                                sgtin: item.uii || batch[batchData.indexOf(item)],
                                manufacturer: ons.manufacturer.name,
                                gtin13: ons.gtin13,
                                apiUrl: ons.apiUrl,
                                data: item
                            });
                        }
                    } else {
                        // Fallback: appels unitaires
                        for (const sgtin of batch) {
                            const data = await this.callManufacturerApi(ons.apiUrl, sgtin, ons.manufacturer);
                            results.push({
                                sgtin,
                                manufacturer: ons.manufacturer.name,
                                gtin13: ons.gtin13,
                                apiUrl: ons.apiUrl,
                                data
                            });
                        }
                    }
                }
            } else {
                // Un seul UII, appel unitaire
                const data = await this.callManufacturerApi(ons.apiUrl, sgtins[0], ons.manufacturer);
                results.push({
                    sgtin: sgtins[0],
                    manufacturer: ons.manufacturer.name,
                    gtin13: ons.gtin13,
                    apiUrl: ons.apiUrl,
                    data
                });
            }
        }

        return results;
    }

    /**
     * Statistiques du cache ONS
     * @returns {Object}
     */
    getCacheStats() {
        return this.onsCache.stats();
    }

    /**
     * Vide le cache ONS
     */
    clearCache() {
        this.onsCache.clear();
        this.logger.info('Cache ONS vidé');
    }
}

export default GdsoService;
