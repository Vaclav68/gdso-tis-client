/**
 * Service GDSO TIS - Module principal
 * Architecture scalable pour tous les fabricants
 */

import { getEnvironmentConfig, TIMEOUTS } from './config.js';
import { getManufacturerConfig, buildApiUrl, buildAllPossibleUrls } from './manufacturers.js';

/**
 * Classe principale du service GDSO
 */
export class GdsoService {
    constructor(options = {}) {
        this.env = options.environment || 'testing';
        this.config = getEnvironmentConfig(this.env);
        this.credentials = {
            username: options.username || process.env.GDSO_USERNAME,
            password: options.password || process.env.GDSO_PASSWORD
        };
        this.token = null;
        this.tokenExpiry = null;
        this.verbose = options.verbose ?? true;
    }

    log(message, level = 'info') {
        if (!this.verbose) return;
        const prefix = { info: '  ', success: '✅', error: '❌', warning: '⚠️' };
        console.log(`${prefix[level] || '  '} ${message}`);
    }

    // ========================================================================
    // SGTIN PARSING
    // ========================================================================

    parseSgtin(sgtinUrn) {
        const regex = /^urn:epc:id:sgtin:(\d+)\.(\d+)\.(\d+)$/;
        const match = sgtinUrn.match(regex);
        if (!match) throw new Error(`Format SGTIN invalide: ${sgtinUrn}`);

        const [, companyPrefix, indicatorItemRef, serialNumber] = match;
        return { companyPrefix, indicatorItemRef, serialNumber, urn: sgtinUrn };
    }

    calculateCheckDigit(digits) {
        let sum = 0;
        for (let i = 0; i < digits.length; i++) {
            const multiplier = (digits.length - i) % 2 === 0 ? 1 : 3;
            sum += parseInt(digits[i], 10) * multiplier;
        }
        return (10 - (sum % 10)) % 10;
    }

    sgtinToGtin13(parsed) {
        const indicator = parsed.indicatorItemRef[0];
        const itemRef = parsed.indicatorItemRef.substring(1);
        const gtin14Base = indicator + parsed.companyPrefix + itemRef;
        const checkDigit = this.calculateCheckDigit(gtin14Base);
        return (gtin14Base + checkDigit).substring(1); // GTIN-13
    }

    gtinToFqdn(gtin) {
        const reversed = gtin.split('').reverse().join('.');
        return `${reversed}.${this.config.ons.suffix}`;
    }

    // ========================================================================
    // ONS RESOLUTION
    // ========================================================================

    async resolveOns(sgtinUrn) {
        const parsed = this.parseSgtin(sgtinUrn);
        const gtin13 = this.sgtinToGtin13(parsed);
        const fqdn = this.gtinToFqdn(gtin13);
        const manufacturer = getManufacturerConfig(parsed.companyPrefix);

        this.log(`Fabricant détecté: ${manufacturer.name} (${parsed.companyPrefix})`);
        this.log(`GTIN-13: ${gtin13}`);
        this.log(`FQDN: ${fqdn}`);

        const url = `${this.config.ons.dnsResolver}?name=${encodeURIComponent(fqdn)}&type=NAPTR`;
        const response = await fetch(url, {
            headers: { 'Accept': 'application/dns-json' },
            signal: AbortSignal.timeout(TIMEOUTS.dns)
        });

        if (!response.ok) throw new Error(`DNS Error: ${response.status}`);
        const data = await response.json();

        if (data.Status !== 0 || !data.Answer?.length) {
            throw new Error('Aucun enregistrement NAPTR trouvé');
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
        if (!apiService) throw new Error('Service GetTireBySgtin non trouvé');

        return {
            parsed,
            gtin13,
            fqdn,
            manufacturer,
            apiUrl: apiService.url,
            services
        };
    }

    // ========================================================================
    // AUTHENTICATION
    // ========================================================================

    async authenticate() {
        // Réutiliser le token s'il est encore valide
        if (this.token && this.tokenExpiry && Date.now() < this.tokenExpiry - 60000) {
            this.log('Réutilisation du token existant');
            return this.token;
        }

        if (!this.credentials.username || !this.credentials.password) {
            throw new Error('Credentials manquants (GDSO_USERNAME/GDSO_PASSWORD)');
        }

        const basicAuth = Buffer.from(
            `${this.credentials.username}:${this.credentials.password}`
        ).toString('base64');

        this.log(`Authentification sur ${this.config.auth.tokenUrl}...`);

        const response = await fetch(this.config.auth.tokenUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${basicAuth}`,
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            signal: AbortSignal.timeout(TIMEOUTS.auth)
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Auth failed (${response.status}): ${text.substring(0, 100)}`);
        }

        const tokenText = await response.text();

        // Le token est retourné directement en JWT
        if (tokenText.startsWith('eyJ')) {
            this.token = tokenText.trim();

            // Extraire l'expiration du JWT
            try {
                const payload = JSON.parse(Buffer.from(this.token.split('.')[1], 'base64').toString());
                this.tokenExpiry = payload.exp * 1000;
                this.log(`Token obtenu (expire: ${new Date(this.tokenExpiry).toLocaleString()})`, 'success');
            } catch {
                this.tokenExpiry = Date.now() + 3600000; // 1h par défaut
            }

            return this.token;
        }

        // Sinon parser comme JSON
        const data = JSON.parse(tokenText);
        this.token = data.AccessToken || data.access_token || data.IdToken;
        if (!this.token) throw new Error('Pas de token dans la réponse');

        this.tokenExpiry = Date.now() + (data.expires_in || 3600) * 1000;
        this.log('Token obtenu', 'success');
        return this.token;
    }

    // ========================================================================
    // API CALL
    // ========================================================================

    async callManufacturerApi(apiUrl, sgtin, manufacturer) {
        const token = await this.authenticate();

        // Construire les URLs à essayer selon le fabricant
        let urls;
        if (manufacturer.urlPatterns) {
            urls = buildAllPossibleUrls(apiUrl, sgtin, manufacturer);
        } else {
            urls = [buildApiUrl(apiUrl, sgtin, manufacturer)];
            // Ajouter aussi sans encodage
            urls.push(buildApiUrl(apiUrl, sgtin, { ...manufacturer, encodeSgtin: false }));
        }

        this.log(`Appel API ${manufacturer.name}...`);

        for (const url of urls) {
            try {
                this.log(`  Tentative: ${url}`);

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
                    this.log('Données reçues!', 'success');

                    // Appliquer transformation si définie
                    return manufacturer.transformResponse
                        ? manufacturer.transformResponse(data)
                        : data;
                }

                this.log(`  ${response.status} ${response.statusText}`, 'warning');

            } catch (error) {
                this.log(`  Erreur: ${error.message}`, 'warning');
            }
        }

        return null;
    }

    // ========================================================================
    // BATCH API CALL
    // ========================================================================

    async callBatchApi(apiUrl, sgtins, manufacturer) {
        const token = await this.authenticate();

        // Construire l'URL batch (généralement /tires ou sans /tire/)
        const baseUrl = apiUrl.endsWith('/') ? apiUrl.slice(0, -1) : apiUrl;
        const batchUrls = [
            baseUrl.replace(/\/tire\/?$/, '/tires'),
            baseUrl.replace(/\/tire\/?$/, ''),
            baseUrl + 's', // /tyres → /tyress non, mais /tire → /tires
            baseUrl
        ];

        this.log(`Appel Batch API ${manufacturer.name} (${sgtins.length} UIIs)...`);

        for (const url of [...new Set(batchUrls)]) {
            try {
                this.log(`  POST ${url}`);

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
                    this.log(`  Succès! ${Array.isArray(data) ? data.length : 1} résultat(s)`, 'success');
                    return data;
                }

                this.log(`  ${response.status} ${response.statusText}`, 'warning');

            } catch (error) {
                this.log(`  Erreur: ${error.message}`, 'warning');
            }
        }

        return null;
    }

    // ========================================================================
    // MAIN METHODS
    // ========================================================================

    async getTireInfo(sgtinUrn) {
        // 1. Résolution ONS
        this.log('\n📋 Résolution ONS...');
        const ons = await this.resolveOns(sgtinUrn);

        // 2. Authentification (implicite dans callManufacturerApi)

        // 3. Appel API fabricant
        this.log('\n📋 Appel API fabricant...');
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
     * Récupère les infos pour plusieurs pneus (batch)
     * Regroupe automatiquement par fabricant
     */
    async getTireInfoBatch(sgtinUrns) {
        // Grouper par company prefix (fabricant)
        const groups = {};
        for (const sgtin of sgtinUrns) {
            const parsed = this.parseSgtin(sgtin);
            if (!groups[parsed.companyPrefix]) {
                groups[parsed.companyPrefix] = [];
            }
            groups[parsed.companyPrefix].push(sgtin);
        }

        this.log(`\n📋 Batch: ${sgtinUrns.length} UIIs, ${Object.keys(groups).length} fabricant(s)`);

        const results = [];

        for (const [prefix, sgtins] of Object.entries(groups)) {
            this.log(`\n📦 Groupe ${prefix} (${sgtins.length} UIIs)`);

            // Résolution ONS pour un UII du groupe
            const ons = await this.resolveOns(sgtins[0]);

            // Appel batch si > 1 UII, sinon appel unitaire
            if (sgtins.length > 1) {
                // Diviser en lots de 100 max
                for (let i = 0; i < sgtins.length; i += 100) {
                    const batch = sgtins.slice(i, i + 100);
                    const batchData = await this.callBatchApi(ons.apiUrl, batch, ons.manufacturer);

                    if (batchData && Array.isArray(batchData)) {
                        for (const item of batchData) {
                            results.push({
                                sgtin: item.uii || batch[batchData.indexOf(item)],
                                manufacturer: ons.manufacturer.name,
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
                                data
                            });
                        }
                    }
                }
            } else {
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
}

export default GdsoService;
