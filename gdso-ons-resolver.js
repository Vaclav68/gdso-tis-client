/**
 * Script de résolution ONS pour GDSO TIS (Tire Information Service)
 * Environnement: Testing (*.testing.gdso.org)
 *
 * Ce script convertit un SGTIN-96 en FQDN et résout l'URL de l'API fabricant
 * via une requête DNS NAPTR.
 */

// UII de test (peut être passé en argument: node gdso-ons-resolver.js "urn:epc:id:sgtin:...")
const TEST_UII = process.argv[2] || 'urn:epc:id:sgtin:086699.0762575.63647563790';

// Configuration de l'environnement
const CONFIG = {
    dnsResolver: 'https://dns.google/resolve',
    onsSuffix: 'gtin.gs1.id.testing.gdso.org'
};

/**
 * Étape 1: Parser le SGTIN URN
 * Format: urn:epc:id:sgtin:<company_prefix>.<indicator_item_ref>.<serial>
 */
function parseSgtin(sgtinUrn) {
    console.log('\n📋 ÉTAPE 1: Parsing du SGTIN');
    console.log('─'.repeat(50));
    console.log(`URN d'entrée: ${sgtinUrn}`);

    const regex = /^urn:epc:id:sgtin:(\d+)\.(\d+)\.(\d+)$/;
    const match = sgtinUrn.match(regex);

    if (!match) {
        throw new Error(`Format SGTIN invalide: ${sgtinUrn}`);
    }

    const [, companyPrefix, indicatorItemRef, serialNumber] = match;

    console.log(`  • Company Prefix: ${companyPrefix}`);
    console.log(`  • Indicator + Item Reference: ${indicatorItemRef}`);
    console.log(`  • Serial Number: ${serialNumber}`);

    return {
        companyPrefix,
        indicatorItemRef,
        serialNumber
    };
}

/**
 * Étape 2: Convertir le SGTIN en GTIN-14
 * Le GTIN-14 est composé de: Indicator (1) + Company Prefix + Item Reference + Check Digit
 */
function sgtinToGtin14(parsed) {
    console.log('\n📋 ÉTAPE 2: Conversion SGTIN → GTIN-14');
    console.log('─'.repeat(50));

    // Le premier chiffre de indicatorItemRef est l'indicator digit
    const indicator = parsed.indicatorItemRef[0];
    const itemReference = parsed.indicatorItemRef.substring(1);

    console.log(`  • Indicator Digit: ${indicator}`);
    console.log(`  • Item Reference: ${itemReference}`);

    // Construction du GTIN-14 sans check digit (13 chiffres)
    const gtin14WithoutCheck = indicator + parsed.companyPrefix + itemReference;
    console.log(`  • GTIN-14 (sans check digit): ${gtin14WithoutCheck}`);

    // Calcul du check digit (algorithme GS1)
    const checkDigit = calculateCheckDigit(gtin14WithoutCheck);
    console.log(`  • Check Digit calculé: ${checkDigit}`);

    const gtin14 = gtin14WithoutCheck + checkDigit;
    console.log(`  • GTIN-14 complet: ${gtin14}`);

    return gtin14;
}

/**
 * Calcul du check digit GS1 (modulo 10)
 */
function calculateCheckDigit(digits) {
    let sum = 0;
    const len = digits.length;

    for (let i = 0; i < len; i++) {
        const digit = parseInt(digits[i], 10);
        // Pour GTIN-14: positions impaires (depuis la droite) × 3, paires × 1
        // En partant de la gauche avec 13 chiffres, les indices pairs × 1, impairs × 3
        const multiplier = (len - i) % 2 === 0 ? 1 : 3;
        sum += digit * multiplier;
    }

    return (10 - (sum % 10)) % 10;
}

/**
 * Étape 3: Convertir le GTIN-14 en FQDN pour la résolution ONS
 * Les chiffres sont inversés et séparés par des points
 */
function gtinToFqdn(gtin14) {
    console.log('\n📋 ÉTAPE 3: Conversion GTIN-14 → FQDN');
    console.log('─'.repeat(50));

    // Inverser les chiffres et les séparer par des points
    const reversedDigits = gtin14.split('').reverse().join('.');
    console.log(`  • Chiffres inversés: ${reversedDigits}`);

    const fqdn = `${reversedDigits}.${CONFIG.onsSuffix}`;
    console.log(`  • FQDN complet: ${fqdn}`);

    return fqdn;
}

/**
 * Étape 4: Requête DNS NAPTR via l'API Google DNS
 */
async function resolveNaptr(fqdn) {
    console.log('\n📋 ÉTAPE 4: Résolution DNS NAPTR');
    console.log('─'.repeat(50));

    const url = `${CONFIG.dnsResolver}?name=${encodeURIComponent(fqdn)}&type=NAPTR`;
    console.log(`  • URL de requête: ${url}`);

    try {
        const response = await fetch(url, {
            headers: {
                'Accept': 'application/dns-json'
            }
        });

        if (!response.ok) {
            throw new Error(`Erreur HTTP: ${response.status}`);
        }

        const data = await response.json();
        console.log(`  • Statut DNS: ${data.Status === 0 ? 'OK' : `Erreur (${data.Status})`}`);

        return data;
    } catch (error) {
        console.error(`  ❌ Erreur lors de la requête DNS: ${error.message}`);
        throw error;
    }
}

/**
 * Étape 5: Parser les enregistrements NAPTR pour extraire les URLs des services
 */
function parseNaptrRecords(dnsResponse) {
    console.log('\n📋 ÉTAPE 5: Parsing des enregistrements NAPTR');
    console.log('─'.repeat(50));

    if (!dnsResponse.Answer || dnsResponse.Answer.length === 0) {
        console.log('  ⚠️ Aucun enregistrement NAPTR trouvé');

        // Afficher les informations de debug si disponibles
        if (dnsResponse.Authority) {
            console.log('\n  📝 Informations Authority (SOA):');
            dnsResponse.Authority.forEach(auth => {
                console.log(`     • ${auth.name} - ${auth.data}`);
            });
        }

        return [];
    }

    const services = [];

    console.log(`  • ${dnsResponse.Answer.length} enregistrement(s) trouvé(s):\n`);

    dnsResponse.Answer.forEach((record, index) => {
        console.log(`  📄 Enregistrement ${index + 1}:`);
        console.log(`     • Type: ${record.type} (NAPTR = 35)`);
        console.log(`     • TTL: ${record.TTL}s`);
        console.log(`     • Data: ${record.data}`);

        // Parser le champ data du NAPTR
        // Format peut être avec ou sans guillemets:
        // "order pref "flags" "service" "regexp" replacement" (RFC standard)
        // ou: order pref flags service regexp replacement (sans guillemets)
        let naptrMatch = record.data.match(
            /^(\d+)\s+(\d+)\s+"([^"]*)"\s+"([^"]*)"\s+"([^"]*)"\s+(\S+)$/
        );

        // Format alternatif sans guillemets (comme observé avec Google DNS)
        if (!naptrMatch) {
            naptrMatch = record.data.match(
                /^(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(!.*!)\s+(\S+)$/
            );
        }

        if (naptrMatch) {
            const [, order, preference, flags, service, regexp, replacement] = naptrMatch;

            console.log(`     • Order: ${order}`);
            console.log(`     • Preference: ${preference}`);
            console.log(`     • Flags: ${flags}`);
            console.log(`     • Service: ${service}`);
            console.log(`     • Regexp: ${regexp}`);
            console.log(`     • Replacement: ${replacement}`);

            // Extraire l'URL du champ regexp
            // Format: !^.*$!https://example.com/path!
            const urlMatch = regexp.match(/!.*!(https?:\/\/[^!]+)!/);
            if (urlMatch) {
                const url = urlMatch[1];
                console.log(`     ✅ URL extraite: ${url}`);
                services.push({
                    service,
                    url,
                    order: parseInt(order),
                    preference: parseInt(preference)
                });
            }
        } else {
            console.log('     ⚠️ Format NAPTR non reconnu');
        }
        console.log('');
    });

    return services;
}

/**
 * Fonction principale
 */
async function main() {
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║   GDSO TIS - Résolution ONS (Object Name Service)          ║');
    console.log('║   Environnement: Testing                                   ║');
    console.log('╚════════════════════════════════════════════════════════════╝');

    try {
        // Étape 1: Parser le SGTIN
        const parsed = parseSgtin(TEST_UII);

        // Étape 2: Convertir en GTIN-14
        const gtin14 = sgtinToGtin14(parsed);

        // Étape 3: Construire le FQDN
        const fqdn = gtinToFqdn(gtin14);

        // Étape 4: Résolution DNS NAPTR
        const dnsResponse = await resolveNaptr(fqdn);

        // Étape 5: Parser les résultats
        const services = parseNaptrRecords(dnsResponse);

        // Résumé final
        console.log('\n╔════════════════════════════════════════════════════════════╗');
        console.log('║   RÉSUMÉ                                                    ║');
        console.log('╚════════════════════════════════════════════════════════════╝');
        console.log(`\n  • UII d'entrée: ${TEST_UII}`);
        console.log(`  • GTIN-14: ${gtin14}`);
        console.log(`  • FQDN: ${fqdn}`);

        if (services.length > 0) {
            console.log('\n  📡 Services découverts:');
            services.forEach(svc => {
                console.log(`     • ${svc.service}: ${svc.url}`);
            });

            // Chercher spécifiquement GetTireBySgtin
            const tireSvc = services.find(s => s.service.includes('GetTireBySgtin'));
            if (tireSvc) {
                console.log(`\n  ✅ URL de l'API GetTireBySgtin: ${tireSvc.url}`);
            }
        } else {
            console.log('\n  ⚠️ Aucun service trouvé dans les enregistrements NAPTR');
            console.log('     Cela peut signifier:');
            console.log('     - Le GTIN n\'est pas enregistré dans l\'ONS GDSO Testing');
            console.log('     - Le format FQDN n\'est pas correct');
            console.log('     - Le serveur ONS n\'a pas d\'enregistrement pour ce préfixe');
        }

        // Si pas de résultat avec GTIN-14, essayer avec GTIN-13
        if (services.length === 0 && dnsResponse.Status !== 0) {
            console.log('\n📋 TENTATIVE ALTERNATIVE: Essai avec GTIN-13');
            console.log('─'.repeat(50));

            // GTIN-13 = GTIN-14 sans le premier caractère (indicator 0)
            const gtin13 = gtin14.substring(1);
            console.log(`  • GTIN-13: ${gtin13}`);

            const fqdn13 = gtin13.split('').reverse().join('.') + '.' + CONFIG.onsSuffix;
            console.log(`  • FQDN (GTIN-13): ${fqdn13}`);

            const dnsResponse13 = await resolveNaptr(fqdn13);
            const services13 = parseNaptrRecords(dnsResponse13);

            if (services13.length > 0) {
                console.log('\n╔════════════════════════════════════════════════════════════╗');
                console.log('║   RÉSULTAT FINAL (avec GTIN-13)                             ║');
                console.log('╚════════════════════════════════════════════════════════════╝');
                console.log(`\n  ✅ Services trouvés avec GTIN-13!`);
                console.log(`  • GTIN-13: ${gtin13}`);
                console.log(`  • FQDN: ${fqdn13}`);
                console.log('\n  📡 Services découverts:');
                services13.forEach(svc => {
                    console.log(`     • ${svc.service}: ${svc.url}`);
                });

                const tireSvc = services13.find(s => s.service.includes('GetTireBySgtin'));
                if (tireSvc) {
                    console.log(`\n  🎯 URL API GetTireBySgtin: ${tireSvc.url}`);
                }

                return { uii: TEST_UII, gtin: gtin13, fqdn: fqdn13, dnsResponse: dnsResponse13, services: services13 };
            }
        }

        // Test de debug: vérifier que le domaine racine existe
        console.log('\n📋 DEBUG: Vérification de la hiérarchie DNS');
        console.log('─'.repeat(50));

        const testDomains = [
            'gtin.gs1.id.testing.gdso.org',
            'gs1.id.testing.gdso.org',
            'id.testing.gdso.org',
            'testing.gdso.org'
        ];

        for (const domain of testDomains) {
            try {
                const resp = await fetch(`${CONFIG.dnsResolver}?name=${domain}&type=NS`);
                const data = await resp.json();
                const status = data.Status === 0 ? '✅ Existe' : data.Status === 3 ? '❌ NXDOMAIN' : `⚠️ Status ${data.Status}`;
                console.log(`  • ${domain}: ${status}`);
            } catch (e) {
                console.log(`  • ${domain}: ❌ Erreur`);
            }
        }

        // Retourner les données pour utilisation ultérieure
        return {
            uii: TEST_UII,
            gtin14,
            fqdn,
            dnsResponse,
            services
        };

    } catch (error) {
        console.error(`\n❌ Erreur: ${error.message}`);
        process.exit(1);
    }
}

// Exécution
main().then(result => {
    console.log('\n✅ Résolution ONS terminée');
}).catch(err => {
    console.error('Erreur fatale:', err);
});
