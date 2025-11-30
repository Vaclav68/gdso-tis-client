#!/usr/bin/env node
/**
 * GDSO TIS Client - CLI scalable
 *
 * Usage:
 *   node gdso.js <sgtin>
 *   node gdso.js --batch <file>
 *   node gdso.js --env production <sgtin>
 */

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { GdsoService } from './lib/gdso-service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Charger .env
const envPath = join(__dirname, '.env');
if (existsSync(envPath)) {
    readFileSync(envPath, 'utf-8').split('\n').forEach(line => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
            const [key, ...val] = trimmed.split('=');
            if (key && val.length) process.env[key.trim()] = val.join('=').trim();
        }
    });
}

// ============================================================================
// CLI
// ============================================================================

function banner() {
    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║  GDSO TIS Client v2.0 - Scalable Architecture            ║');
    console.log('╚══════════════════════════════════════════════════════════╝');
}

function displayTireInfo(result) {
    console.log('\n╔══════════════════════════════════════════════════════════╗');
    console.log('║  INFORMATIONS DU PNEU                                    ║');
    console.log('╚══════════════════════════════════════════════════════════╝');

    console.log(`\n  UII: ${result.sgtin}`);
    console.log(`  Fabricant: ${result.manufacturer}`);
    if (result.gtin13) console.log(`  GTIN-13: ${result.gtin13}`);

    if (result.data) {
        const d = result.data;

        // === PRODUIT ===
        if (d.product) {
            console.log('\n  ╭─────────────────────────────────────────────────────────╮');
            console.log('  │  PRODUIT                                                │');
            console.log('  ╰─────────────────────────────────────────────────────────╯');
            if (d.product.brandName) console.log(`     Marque: ${d.product.brandName}`);
            if (d.product.commercialName) console.log(`     Nom commercial: ${d.product.commercialName}`);
            if (d.product.commercialNameLongDescription) {
                console.log(`     Description: ${d.product.commercialNameLongDescription}`);
            }
            if (d.product.productType) console.log(`     Type produit: ${d.product.productType}`);
            if (d.product.labelTireClassAssociated) console.log(`     Classe: ${d.product.labelTireClassAssociated}`);

            // ItemIDS (EAN/UPC)
            if (d.product.itemIDS) {
                if (d.product.itemIDS.eanCode) console.log(`     Code EAN: ${d.product.itemIDS.eanCode}`);
                if (d.product.itemIDS.upcCode) console.log(`     Code UPC: ${d.product.itemIDS.upcCode}`);
            }

            // URLs
            if (d.product.urls?.length) {
                for (const u of d.product.urls) {
                    console.log(`     URL ${u.website || 'Web'}: ${u.url}`);
                }
            }
        }

        // === DIMENSIONS ===
        if (d.product?.dimensions) {
            console.log('\n  ╭─────────────────────────────────────────────────────────╮');
            console.log('  │  DIMENSIONS                                             │');
            console.log('  ╰─────────────────────────────────────────────────────────╯');
            const dim = d.product.dimensions;
            if (dim.geometricalTyreSize) console.log(`     Taille: ${dim.geometricalTyreSize}`);
            if (dim.sectionWidth?.value) {
                console.log(`     Largeur section: ${dim.sectionWidth.value} ${dim.sectionWidth.uom || 'mm'}`);
            }
            if (dim.aspectRatio) console.log(`     Ratio (série): ${dim.aspectRatio}`);
            if (dim.rimCode?.value) {
                console.log(`     Diamètre jante: ${dim.rimCode.value} ${dim.rimCode.uom || 'pouces'}`);
            }
        }

        // === SPÉCIFICATIONS ===
        if (d.product?.specifications) {
            console.log('\n  ╭─────────────────────────────────────────────────────────╮');
            console.log('  │  SPECIFICATIONS                                         │');
            console.log('  ╰─────────────────────────────────────────────────────────╯');
            const spec = d.product.specifications;
            if (spec.loadIndex) console.log(`     Indice de charge: ${spec.loadIndex}`);
            if (spec.loadIndexForDualFitment) console.log(`     Indice charge (jumelage): ${spec.loadIndexForDualFitment}`);
            if (spec.speedSymbol) console.log(`     Indice de vitesse: ${spec.speedSymbol}`);
            if (spec.structure) console.log(`     Structure: ${spec.structure === 'R' ? 'Radial' : 'Bias'}`);
            if (spec.tubeCharacteristic) console.log(`     Type: ${spec.tubeCharacteristic === 'TL' ? 'Tubeless' : 'Tube Type'}`);
            if (spec.extraLoadOrReinforced !== undefined) {
                console.log(`     Extra Load/Renforcé: ${spec.extraLoadOrReinforced ? 'Oui' : 'Non'}`);
            }
            if (spec.runFlat) console.log(`     Run Flat: ${spec.runFlat}`);
            if (spec.sealant !== undefined) console.log(`     Sealant (anti-crevaison): ${spec.sealant ? 'Oui' : 'Non'}`);
            if (spec.directional !== undefined) console.log(`     Directionnel: ${spec.directional ? 'Oui' : 'Non'}`);
            if (spec.asymetrical !== undefined) console.log(`     Asymétrique: ${spec.asymetrical ? 'Oui' : 'Non'}`);
            if (spec.maxLoadCarryingCapacity) console.log(`     Capacité charge max: ${spec.maxLoadCarryingCapacity} kg`);
            if (spec.hlpc !== undefined) console.log(`     High Load (HL): ${spec.hlpc ? 'Oui' : 'Non'}`);
        }

        // === MARQUAGES ===
        if (d.product?.markings) {
            console.log('\n  ╭─────────────────────────────────────────────────────────╮');
            console.log('  │  MARQUAGES                                              │');
            console.log('  ╰─────────────────────────────────────────────────────────╯');
            const mark = d.product.markings;
            if (mark.mudAndSnow !== undefined) console.log(`     M+S (Boue & Neige): ${mark.mudAndSnow ? 'Oui' : 'Non'}`);
            if (mark['3pmsf'] !== undefined) console.log(`     3PMSF (Flocon): ${mark['3pmsf'] ? 'Oui' : 'Non'}`);
            if (mark.iceGrip !== undefined) console.log(`     Ice Grip: ${mark.iceGrip ? 'Oui' : 'Non'}`);
            if (mark.tractionTire !== undefined) console.log(`     Pneu Traction: ${mark.tractionTire ? 'Oui' : 'Non'}`);
            if (mark.freeRollingTire !== undefined) console.log(`     Free Rolling (FRT): ${mark.freeRollingTire ? 'Oui' : 'Non'}`);
            if (mark.professionnalOfRoad !== undefined) console.log(`     POR (Off-Road Pro): ${mark.professionnalOfRoad ? 'Oui' : 'Non'}`);
            if (mark.sizePrefix) console.log(`     Préfixe taille: ${mark.sizePrefix}`);
            if (mark.sizeSuffix) console.log(`     Suffixe taille: ${mark.sizeSuffix}`);
            if (mark.maxInflationPressure) console.log(`     Pression max: ${mark.maxInflationPressure} kPa`);

            // OE Markings (constructeurs auto)
            if (mark.OEMarking?.length) {
                const oeList = mark.OEMarking.map(oe =>
                    typeof oe === 'string' ? oe : `${oe.tireMarking}${oe.oemName ? ` (${oe.oemName})` : ''}`
                ).join(', ');
                console.log(`     Marquages OE: ${oeList}`);
            }
        }

        // === ÉTIQUETAGE EU ===
        if (d.product?.labelling?.length) {
            console.log('\n  ╭─────────────────────────────────────────────────────────╮');
            console.log('  │  ETIQUETAGE EU (Label Européen)                         │');
            console.log('  ╰─────────────────────────────────────────────────────────╯');
            for (const label of d.product.labelling) {
                if (label.rollingResistanceClass) console.log(`     Résistance roulement: ${label.rollingResistanceClass}`);
                if (label.wetClass) console.log(`     Adhérence pluie: ${label.wetClass}`);
                if (label.noiseClass) console.log(`     Classe bruit: ${label.noiseClass}`);
                if (label.noisePerformance) console.log(`     Bruit: ${label.noisePerformance} dB`);
                if (label.labellingReferenceRegulation) console.log(`     Règlement: ${label.labellingReferenceRegulation}`);
                if (label.eprelRecordReferenceUrl) console.log(`     EPREL: ${label.eprelRecordReferenceUrl}`);
                if (label.labelPictureUrl) console.log(`     Image label: ${label.labelPictureUrl}`);
            }
        }

        // === PRODUCTION (DOT/TIN) ===
        if (d.dotTin) {
            console.log('\n  ╭─────────────────────────────────────────────────────────╮');
            console.log('  │  PRODUCTION (DOT/TIN)                                   │');
            console.log('  ╰─────────────────────────────────────────────────────────╯');
            if (d.dotTin.weekYear) {
                const week = d.dotTin.weekYear.substring(0, 2);
                const year = d.dotTin.weekYear.substring(2);
                console.log(`     Date: Semaine ${week}, 20${year}`);
            }
            if (d.dotTin.factoryCode) console.log(`     Code usine: ${d.dotTin.factoryCode}`);
            if (d.dotTin.sizeCode) console.log(`     Code taille: ${d.dotTin.sizeCode}`);
            if (d.dotTin.optionalCode) console.log(`     Code optionnel: ${d.dotTin.optionalCode}`);
        }

        // === ORIGINE & CONFORMITÉ ===
        if (d.countryOfOrigin || d.nationalRegulationsCompliances?.length) {
            console.log('\n  ╭─────────────────────────────────────────────────────────╮');
            console.log('  │  ORIGINE & CONFORMITE                                   │');
            console.log('  ╰─────────────────────────────────────────────────────────╯');
            if (d.countryOfOrigin) console.log(`     Pays d'origine: ${d.countryOfOrigin}`);
            if (d.nationalRegulationsComplianceCode) console.log(`     Code conformité: ${d.nationalRegulationsComplianceCode}`);
            if (d.nationalRegulationsCompliances?.length) {
                const regs = d.nationalRegulationsCompliances.map(r => r.marking).join(', ');
                console.log(`     Conformités: ${regs}`);
            }
        }

        // === DONNÉES TECHNIQUES ===
        if (d.weight || d.rollingCircumference || d.vectoTyreRollingResistance || d.wltpTyreRollingResistance) {
            console.log('\n  ╭─────────────────────────────────────────────────────────╮');
            console.log('  │  DONNEES TECHNIQUES                                     │');
            console.log('  ╰─────────────────────────────────────────────────────────╯');
            if (d.weight?.value) console.log(`     Poids: ${d.weight.value} ${d.weight.uom || 'kg'}`);
            if (d.rollingCircumference?.value) {
                console.log(`     Circonférence: ${d.rollingCircumference.value} ${d.rollingCircumference.uom || 'mm'}`);
            }
            if (d.vectoTyreRollingResistance?.value) {
                console.log(`     VECTO RRC: ${d.vectoTyreRollingResistance.value} ${d.vectoTyreRollingResistance.uom || 'N/kN'}`);
            }
            if (d.vectoCertificateNumber) console.log(`     Certificat VECTO: ${d.vectoCertificateNumber}`);
            if (d.wltpTyreRollingResistance?.value) {
                console.log(`     WLTP RRC: ${d.wltpTyreRollingResistance.value} ${d.wltpTyreRollingResistance.uom || 'kg/T'}`);
            }
        }

        // === DONNÉES OEM (si présentes) ===
        if (d.developmentIdentifier || d.customerPartNumber || d.oemSubmissionIdentifier || d.product?.supplierId) {
            console.log('\n  ╭─────────────────────────────────────────────────────────╮');
            console.log('  │  DONNEES OEM/DEVELOPPEMENT                              │');
            console.log('  ╰─────────────────────────────────────────────────────────╯');
            if (d.product?.supplierId) console.log(`     ID Fournisseur: ${d.product.supplierId}`);
            if (d.developmentIdentifier) console.log(`     ID Développement: ${d.developmentIdentifier}`);
            if (d.customerPartNumber) console.log(`     Réf. Client: ${d.customerPartNumber}`);
            if (d.oemSubmissionIdentifier) console.log(`     ID Soumission OEM: ${d.oemSubmissionIdentifier}`);
        }

    } else {
        console.log('\n  ⚠️ Données non disponibles');
        console.log('     Le SGTIN n\'existe peut-être pas dans la base de test.');
    }
}

async function processOne(sgtin, env) {
    const service = new GdsoService({ environment: env });

    try {
        const result = await service.getTireInfo(sgtin);
        displayTireInfo(result);
        return result;
    } catch (error) {
        console.error(`\n❌ Erreur: ${error.message}`);
        return null;
    }
}

async function processBatch(file, env) {
    const content = readFileSync(file, 'utf-8');
    const sgtins = content.split('\n')
        .map(l => l.trim())
        .filter(l => l && l.startsWith('urn:epc:id:sgtin:'));

    console.log(`\n📋 Traitement de ${sgtins.length} UIIs...\n`);

    const results = [];
    for (const sgtin of sgtins) {
        console.log(`\n${'─'.repeat(60)}`);
        const result = await processOne(sgtin, env);
        results.push({ sgtin, result });
    }

    // Résumé
    console.log('\n' + '═'.repeat(60));
    console.log('RÉSUMÉ BATCH');
    console.log('═'.repeat(60));

    const success = results.filter(r => r.result?.data).length;
    const partial = results.filter(r => r.result && !r.result.data).length;
    const failed = results.filter(r => !r.result).length;

    console.log(`  ✅ Succès complet: ${success}`);
    console.log(`  ⚠️ Succès partiel (pas de données): ${partial}`);
    console.log(`  ❌ Échecs: ${failed}`);

    return results;
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
    banner();

    const args = process.argv.slice(2);
    let env = 'testing';
    let batchFile = null;
    let sgtin = null;

    // Parser les arguments
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--env' && args[i + 1]) {
            env = args[++i];
        } else if (args[i] === '--batch' && args[i + 1]) {
            batchFile = args[++i];
        } else if (args[i].startsWith('urn:epc:id:sgtin:')) {
            sgtin = args[i];
        }
    }

    console.log(`\n  Environnement: ${env.toUpperCase()}`);

    if (batchFile) {
        await processBatch(batchFile, env);
    } else if (sgtin) {
        await processOne(sgtin, env);
    } else {
        console.log('\n  Usage:');
        console.log('    node gdso.js <sgtin>');
        console.log('    node gdso.js --batch <file>');
        console.log('    node gdso.js --env production <sgtin>');
        console.log('\n  Exemple:');
        console.log('    node gdso.js "urn:epc:id:sgtin:086699.0762575.63647563790"');
        console.log('    node gdso.js --batch "uIIS de test"');
    }

    console.log('\n✅ Terminé');
}

main().catch(err => {
    console.error('Erreur fatale:', err.message);
    process.exit(1);
});
