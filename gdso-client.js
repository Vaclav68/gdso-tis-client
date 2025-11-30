/**
 * Client complet GDSO TIS (Tire Information Service)
 * Environnement: Testing (*.testing.gdso.org)
 *
 * Ce script effectue le flux complet :
 * 1. Résolution ONS (DNS NAPTR) pour découvrir l'URL de l'API fabricant
 * 2. Authentification OAuth2 sur manage.testing.gdso.org
 * 3. Appel à l'API du fabricant pour récupérer les infos du pneu
 *
 * Usage:
 *   node gdso-client.js
 *   node gdso-client.js "urn:epc:id:sgtin:086699.0762575.63647563790"
 *
 * Variables d'environnement requises (dans .env ou exportées):
 *   GDSO_USERNAME - Nom d'utilisateur GDSO
 *   GDSO_PASSWORD - Mot de passe GDSO
 */

// Charger les variables d'environnement depuis .env
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Charger .env si présent
const envPath = join(__dirname, '.env');
if (existsSync(envPath)) {
    const envContent = readFileSync(envPath, 'utf-8');
    envContent.split('\n').forEach(line => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
            const [key, ...valueParts] = trimmed.split('=');
            const value = valueParts.join('=');
            if (key && value) {
                process.env[key.trim()] = value.trim();
            }
        }
    });
}

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
    // Environnement Testing GDSO
    oauth: {
        // Endpoint principal d'authentification (API System - Solution 2)
        tokenUrl: process.env.GDSO_TOKEN_URL || 'https://authentication-api.testing.gdso.org/getIdToken',
        // Cognito endpoints (Solution 1 - OpenID Connect)
        cognitoUrl: 'https://fuqzxw2k75c49t2fdn.auth.eu-central-1.amazoncognito.com',
        // JWKS pour vérification des tokens
        jwksUrl: 'https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_yIbrF9hG3/.well-known/jwks.json'
    },
    dns: {
        resolver: 'https://dns.google/resolve',
        onsSuffix: 'gtin.gs1.id.testing.gdso.org'
    },
    // Credentials (à définir via variables d'environnement ou .env)
    credentials: {
        username: process.env.GDSO_USERNAME || '',
        password: process.env.GDSO_PASSWORD || '',
        // Client credentials (si nécessaire en plus)
        clientId: process.env.GDSO_CLIENT_ID || '',
        clientSecret: process.env.GDSO_CLIENT_SECRET || ''
    }
};

// UII de test
const TEST_UII = process.argv[2] || 'urn:epc:id:sgtin:086699.0762575.63647563790';

// ============================================================================
// UTILITAIRES
// ============================================================================

function log(message, level = 'info') {
    const prefix = {
        info: '  ',
        success: '  ✅',
        error: '  ❌',
        warning: '  ⚠️',
        step: '📋'
    };
    console.log(`${prefix[level] || '  '} ${message}`);
}

function header(title) {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`📋 ${title}`);
    console.log('─'.repeat(60));
}

function banner(title) {
    console.log('\n╔' + '═'.repeat(58) + '╗');
    console.log('║  ' + title.padEnd(56) + '║');
    console.log('╚' + '═'.repeat(58) + '╝');
}

// ============================================================================
// ÉTAPE 1: RÉSOLUTION ONS
// ============================================================================

/**
 * Parse un SGTIN URN et extrait les composants
 */
function parseSgtin(sgtinUrn) {
    const regex = /^urn:epc:id:sgtin:(\d+)\.(\d+)\.(\d+)$/;
    const match = sgtinUrn.match(regex);

    if (!match) {
        throw new Error(`Format SGTIN invalide: ${sgtinUrn}`);
    }

    const [, companyPrefix, indicatorItemRef, serialNumber] = match;
    return { companyPrefix, indicatorItemRef, serialNumber };
}

/**
 * Calcule le check digit GS1 (modulo 10)
 */
function calculateCheckDigit(digits) {
    let sum = 0;
    const len = digits.length;
    for (let i = 0; i < len; i++) {
        const digit = parseInt(digits[i], 10);
        const multiplier = (len - i) % 2 === 0 ? 1 : 3;
        sum += digit * multiplier;
    }
    return (10 - (sum % 10)) % 10;
}

/**
 * Convertit un SGTIN en GTIN-13
 */
function sgtinToGtin13(parsed) {
    const indicator = parsed.indicatorItemRef[0];
    const itemReference = parsed.indicatorItemRef.substring(1);
    const gtin14WithoutCheck = indicator + parsed.companyPrefix + itemReference;
    const checkDigit = calculateCheckDigit(gtin14WithoutCheck);
    const gtin14 = gtin14WithoutCheck + checkDigit;
    // GTIN-13 = GTIN-14 sans le premier caractère
    return gtin14.substring(1);
}

/**
 * Convertit un GTIN en FQDN pour la résolution ONS
 */
function gtinToFqdn(gtin) {
    const reversedDigits = gtin.split('').reverse().join('.');
    return `${reversedDigits}.${CONFIG.dns.onsSuffix}`;
}

/**
 * Résout les enregistrements DNS NAPTR via Google DNS
 */
async function resolveNaptr(fqdn) {
    const url = `${CONFIG.dns.resolver}?name=${encodeURIComponent(fqdn)}&type=NAPTR`;

    const response = await fetch(url, {
        headers: { 'Accept': 'application/dns-json' }
    });

    if (!response.ok) {
        throw new Error(`Erreur DNS HTTP: ${response.status}`);
    }

    return response.json();
}

/**
 * Parse les enregistrements NAPTR pour extraire les services
 */
function parseNaptrRecords(dnsResponse) {
    if (!dnsResponse.Answer || dnsResponse.Answer.length === 0) {
        return [];
    }

    const services = [];

    dnsResponse.Answer.forEach(record => {
        // Format: order pref flags service regexp replacement
        const naptrMatch = record.data.match(
            /^(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(!.*!)\s+(\S+)$/
        );

        if (naptrMatch) {
            const [, order, preference, flags, service, regexp] = naptrMatch;
            const urlMatch = regexp.match(/!.*!(https?:\/\/[^!]+)!/);

            if (urlMatch) {
                services.push({
                    service,
                    url: urlMatch[1],
                    order: parseInt(order),
                    preference: parseInt(preference)
                });
            }
        }
    });

    return services;
}

/**
 * Effectue la résolution ONS complète
 */
async function resolveOns(sgtinUrn) {
    header('ÉTAPE 1: Résolution ONS (Object Name Service)');

    log(`UII: ${sgtinUrn}`);

    // Parser le SGTIN
    const parsed = parseSgtin(sgtinUrn);
    log(`Company Prefix: ${parsed.companyPrefix}`);

    // Convertir en GTIN-13
    const gtin13 = sgtinToGtin13(parsed);
    log(`GTIN-13: ${gtin13}`);

    // Construire le FQDN
    const fqdn = gtinToFqdn(gtin13);
    log(`FQDN: ${fqdn}`);

    // Résolution DNS
    log(`Requête DNS NAPTR...`);
    const dnsResponse = await resolveNaptr(fqdn);

    if (dnsResponse.Status !== 0) {
        throw new Error(`Résolution DNS échouée (Status: ${dnsResponse.Status})`);
    }

    // Parser les services
    const services = parseNaptrRecords(dnsResponse);

    if (services.length === 0) {
        throw new Error('Aucun service trouvé dans les enregistrements NAPTR');
    }

    log(`${services.length} service(s) découvert(s):`, 'success');
    services.forEach(svc => {
        log(`  • ${svc.service}: ${svc.url}`);
    });

    // Trouver GetTireBySgtin
    const tireSvc = services.find(s => s.service.includes('GetTireBySgtin'));
    if (!tireSvc) {
        throw new Error('Service GetTireBySgtin non trouvé');
    }

    return {
        gtin13,
        fqdn,
        services,
        apiUrl: tireSvc.url
    };
}

// ============================================================================
// ÉTAPE 2: AUTHENTIFICATION OAUTH2
// ============================================================================

/**
 * Obtient un token via l'API GDSO Authentication (Basic Auth)
 * Doc: https://gdso-org.github.io/tech-doc/docs/getting-started/authentication/
 */
async function getOAuthToken() {
    header('ÉTAPE 2: Authentification GDSO');

    const { username, password } = CONFIG.credentials;

    if (!username || !password) {
        log('Credentials manquants!', 'error');
        log('Créez un fichier .env avec:', 'warning');
        log('  GDSO_USERNAME=votre_username');
        log('  GDSO_PASSWORD=votre_password');
        throw new Error('GDSO_USERNAME et GDSO_PASSWORD requis');
    }

    log(`Endpoint: ${CONFIG.oauth.tokenUrl}`);
    log(`Username: ${username}`);

    // Créer le header Basic Auth
    const basicAuth = Buffer.from(`${username}:${password}`).toString('base64');

    try {
        log('Demande de token en cours...');

        const response = await fetch(CONFIG.oauth.tokenUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${basicAuth}`,
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        });

        const responseText = await response.text();
        log(`HTTP Status: ${response.status}`);

        if (!response.ok) {
            log(`Erreur: ${responseText.substring(0, 200)}`, 'error');
            throw new Error(`Authentification échouée (HTTP ${response.status})`);
        }

        // La réponse peut être soit un JWT brut, soit un objet JSON
        let accessToken;

        // Vérifier si c'est un JWT brut (commence par eyJ)
        if (responseText.startsWith('eyJ')) {
            accessToken = responseText.trim();
            log('Token JWT reçu directement', 'success');
            log(`Token: ${accessToken.substring(0, 50)}...`);

            // Décoder le payload du JWT pour afficher les infos
            try {
                const payload = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64').toString());
                if (payload.sub) log(`Subject: ${payload.sub}`);
                if (payload.exp) {
                    const expDate = new Date(payload.exp * 1000);
                    log(`Expire: ${expDate.toLocaleString()}`);
                }
            } catch (e) {
                // Ignore decode errors
            }

            return {
                accessToken: accessToken,
                idToken: accessToken,
                tokenType: 'Bearer'
            };
        }

        // Sinon, parser comme JSON
        const tokenData = JSON.parse(responseText);
        log(`Clés reçues: ${Object.keys(tokenData).join(', ')}`);

        accessToken = tokenData.AccessToken || tokenData.access_token || tokenData.IdToken || tokenData.idToken;

        if (!accessToken) {
            log(`Réponse inattendue: ${responseText.substring(0, 200)}`, 'error');
            throw new Error('Pas de token dans la réponse');
        }

        log('Token obtenu!', 'success');
        log(`Token: ${accessToken.substring(0, 50)}...`);

        return {
            accessToken: accessToken,
            idToken: tokenData.IdToken,
            refreshToken: tokenData.RefreshToken,
            tokenType: 'Bearer'
        };

    } catch (error) {
        if (error.cause?.code === 'ENOTFOUND') {
            log(`Impossible de joindre ${CONFIG.oauth.tokenUrl}`, 'error');
        }
        throw error;
    }
}

// ============================================================================
// ÉTAPE 3: APPEL API FABRICANT
// ============================================================================

/**
 * Appelle l'API du fabricant pour récupérer les infos du pneu
 */
async function getTireInfo(apiBaseUrl, sgtinUrn, accessToken) {
    header('ÉTAPE 3: Appel API Fabricant');

    // Normaliser l'URL de base (enlever trailing slash si présent)
    const baseUrl = apiBaseUrl.endsWith('/') ? apiBaseUrl.slice(0, -1) : apiBaseUrl;

    // Essayer différents formats d'URL selon les implémentations fabricants
    const urlFormats = [
        // Format 1: SGTIN directement après l'URL de base (Pirelli, Continental)
        `${baseUrl}/${encodeURIComponent(sgtinUrn)}`,
        // Format 2: SGTIN sans encodage
        `${baseUrl}/${sgtinUrn}`,
        // Format 3: Avec /tire/ (Michelin style)
        `${baseUrl}/tire/${encodeURIComponent(sgtinUrn)}`,
        // Format 4: Sans encodage avec /tire/
        `${baseUrl}/tire/${sgtinUrn}`,
        // Format 5: Juste les chiffres du SGTIN
        `${baseUrl}/${sgtinUrn.replace('urn:epc:id:sgtin:', '')}`
    ];

    log(`Base URL: ${apiBaseUrl}`);
    log(`Authorization: Bearer ${accessToken.substring(0, 20)}...`);

    let lastError = null;
    let lastResponse = null;

    for (const apiUrl of urlFormats) {
        try {
            log(`\nTentative: ${apiUrl}`);

            const response = await fetch(apiUrl, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                }
            });

            const responseText = await response.text();
            lastResponse = { status: response.status, text: responseText };

            log(`  Status: ${response.status} ${response.statusText}`);

            if (response.ok && responseText) {
                try {
                    const tireData = JSON.parse(responseText);
                    log('Données reçues!', 'success');
                    return tireData;
                } catch (e) {
                    log(`  Réponse non-JSON: ${responseText.substring(0, 100)}`, 'warning');
                }
            } else if (response.status === 404) {
                log(`  404 - Pneu non trouvé ou endpoint incorrect`, 'warning');
            } else if (response.status === 401) {
                log(`  401 - Token invalide`, 'warning');
            } else if (response.status === 403) {
                log(`  403 - Accès refusé`, 'warning');
            }

            lastError = new Error(`HTTP ${response.status}`);

        } catch (error) {
            log(`  Erreur: ${error.message}`, 'warning');
            lastError = error;
        }
    }

    // Aucun format n'a fonctionné
    log('\nTous les formats d\'URL ont échoué', 'error');
    if (lastResponse) {
        log(`Dernière réponse: ${lastResponse.status} - ${lastResponse.text.substring(0, 200)}`);
    }

    // En mode test, on peut quand même retourner null au lieu de throw
    return null;
}

/**
 * Affiche les informations du pneu de manière formatée
 */
function displayTireInfo(tireData) {
    banner('INFORMATIONS DU PNEU');

    if (!tireData) {
        log('Aucune donnée à afficher', 'warning');
        return;
    }

    // UII
    if (tireData.uii) {
        log(`UII: ${tireData.uii}`);
    }

    // Produit
    if (tireData.product) {
        const p = tireData.product;
        console.log('\n  📦 PRODUIT');
        if (p.brandName) log(`  Marque: ${p.brandName}`);
        if (p.commercialName) log(`  Nom commercial: ${p.commercialName}`);
        if (p.commercialNameLongDescription) log(`  Description: ${p.commercialNameLongDescription}`);

        // IDs
        if (p.itemIDS) {
            if (p.itemIDS.eanCode) log(`  EAN: ${p.itemIDS.eanCode}`);
            if (p.itemIDS.upcCode) log(`  UPC: ${p.itemIDS.upcCode}`);
        }
    }

    // Dimensions
    if (tireData.product?.dimensions) {
        const d = tireData.product.dimensions;
        console.log('\n  📐 DIMENSIONS');
        if (d.geometricalTyreSize) log(`  Taille: ${d.geometricalTyreSize}`);
        if (d.sectionWidth?.value) log(`  Largeur: ${d.sectionWidth.value} ${d.sectionWidth.uom || 'mm'}`);
        if (d.aspectRatio) log(`  Ratio: ${d.aspectRatio}`);
        if (d.rimCode?.value) log(`  Jante: ${d.rimCode.value} ${d.rimCode.uom || 'pouces'}`);
    }

    // Spécifications
    if (tireData.product?.specifications) {
        const s = tireData.product.specifications;
        console.log('\n  ⚙️ SPÉCIFICATIONS');
        if (s.loadIndex) log(`  Indice de charge: ${s.loadIndex}`);
        if (s.speedSymbol) log(`  Indice de vitesse: ${s.speedSymbol}`);
        if (s.structure) log(`  Structure: ${s.structure === 'R' ? 'Radial' : 'Bias'}`);
        if (s.tubeCharacteristic) log(`  Type: ${s.tubeCharacteristic === 'TL' ? 'Tubeless' : 'Tube Type'}`);
        if (s.runFlat) log(`  Run Flat: ${s.runFlat}`);
        if (s.extraLoadOrReinforced) log(`  Renforcé: Oui`);
    }

    // Marquages
    if (tireData.product?.markings) {
        const m = tireData.product.markings;
        console.log('\n  🏷️ MARQUAGES');
        if (m.mudAndSnow) log(`  M+S: Oui`);
        if (m['3pmsf']) log(`  3PMSF (Neige): Oui`);
        if (m.iceGrip) log(`  Ice Grip: Oui`);
        if (m.OEMarking?.length > 0) {
            m.OEMarking.forEach(oe => {
                log(`  OE ${oe.oemName}: ${oe.tireMarking}`);
            });
        }
    }

    // Labelling (étiquette énergie)
    if (tireData.product?.labelling?.length > 0) {
        const l = tireData.product.labelling[0];
        console.log('\n  🏷️ ÉTIQUETTE ÉNERGIE');
        if (l.rollingResistanceClass) log(`  Résistance roulement: ${l.rollingResistanceClass}`);
        if (l.wetClass) log(`  Adhérence mouillée: ${l.wetClass}`);
        if (l.noiseClass) log(`  Classe bruit: ${l.noiseClass}`);
        if (l.noisePerformance) log(`  Niveau sonore: ${l.noisePerformance} dB`);
        if (l.eprelRecordReferenceUrl) log(`  EPREL: ${l.eprelRecordReferenceUrl}`);
    }

    // DOT/TIN
    if (tireData.dotTin) {
        const dot = tireData.dotTin;
        console.log('\n  📋 DOT/TIN');
        if (dot.factoryCode) log(`  Code usine: ${dot.factoryCode}`);
        if (dot.weekYear) log(`  Date production: Semaine ${dot.weekYear.substring(0, 2)}/20${dot.weekYear.substring(2)}`);
    }

    // Origine
    if (tireData.countryOfOrigin) {
        log(`\n  🌍 Pays d'origine: ${tireData.countryOfOrigin}`);
    }
}

// ============================================================================
// FONCTION PRINCIPALE
// ============================================================================

async function main() {
    banner('GDSO TIS - Client Complet (Testing)');
    console.log(`\n  UII: ${TEST_UII}\n`);

    try {
        // Étape 1: Résolution ONS
        const onsResult = await resolveOns(TEST_UII);

        // Étape 2: Authentification OAuth2
        let tokenResult;
        try {
            tokenResult = await getOAuthToken();
        } catch (authError) {
            log('\nImpossible d\'obtenir le token OAuth.', 'error');
            log('Le flux continue sans authentification pour le debug.\n', 'warning');

            // Afficher le résumé ONS quand même
            banner('RÉSUMÉ (ONS uniquement)');
            log(`GTIN-13: ${onsResult.gtin13}`);
            log(`API URL découverte: ${onsResult.apiUrl}`);
            log('\nPour compléter le flux, configurez les credentials OAuth:');
            log('  export GDSO_CLIENT_ID="..."');
            log('  export GDSO_CLIENT_SECRET="..."');
            return;
        }

        // Étape 3: Appel API
        const tireData = await getTireInfo(
            onsResult.apiUrl,
            TEST_UII,
            tokenResult.accessToken
        );

        // Résumé final
        if (tireData) {
            // Afficher les résultats
            displayTireInfo(tireData);

            banner('FLUX TERMINÉ AVEC SUCCÈS');
            log(`UII: ${TEST_UII}`);
            log(`Fabricant: ${tireData.product?.brandName || 'N/A'}`);
            log(`Produit: ${tireData.product?.commercialName || 'N/A'}`);
        } else {
            banner('RÉSUMÉ - Flux partiellement réussi');
            log(`UII: ${TEST_UII}`);
            log(`GTIN-13: ${onsResult.gtin13}`);
            log(`API URL: ${onsResult.apiUrl}`);
            log(`Token: Obtenu avec succès`, 'success');
            log(`Données pneu: Non disponibles (404)`, 'warning');
            log('');
            log('Le SGTIN de test n\'existe probablement pas dans');
            log('la base de données du fabricant (environnement Testing).');
        }

        return tireData;

    } catch (error) {
        console.error(`\n❌ ERREUR: ${error.message}`);
        if (process.env.DEBUG) {
            console.error(error.stack);
        }
        process.exit(1);
    }
}

// Exécution
main().then(() => {
    console.log('\n✅ Terminé');
}).catch(err => {
    console.error('Erreur fatale:', err.message);
    process.exit(1);
});
