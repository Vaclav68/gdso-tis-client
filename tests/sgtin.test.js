/**
 * Tests unitaires - Parsing et conversion SGTIN
 * Utilise le test runner natif Node.js (node:test)
 *
 * @run node --test tests/sgtin.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GdsoService } from '../lib/gdso-service.js';
import { SgtinParseError } from '../lib/errors.js';

// Instance sans logs pour les tests
const service = new GdsoService({ verbose: false });

describe('SGTIN Parsing', () => {

    it('parse un SGTIN Michelin valide', () => {
        const sgtin = 'urn:epc:id:sgtin:086699.0988229.72916502389';
        const result = service.parseSgtin(sgtin);

        assert.equal(result.companyPrefix, '086699');
        assert.equal(result.indicatorItemRef, '0988229');
        assert.equal(result.serialNumber, '72916502389');
        assert.equal(result.urn, sgtin);
    });

    it('parse un SGTIN Goodyear valide', () => {
        const sgtin = 'urn:epc:id:sgtin:54520007.088855.123456789';
        const result = service.parseSgtin(sgtin);

        assert.equal(result.companyPrefix, '54520007');
        assert.equal(result.indicatorItemRef, '088855');
        assert.equal(result.serialNumber, '123456789');
    });

    it('rejette un format SGTIN invalide', () => {
        const invalidSgtins = [
            'invalid',
            'urn:epc:id:sgtin:abc.def.ghi',
            'urn:epc:id:sgtin:086699.0988229', // Manque serial
            'sgtin:086699.0988229.123',        // Mauvais préfixe
            '',
            null
        ];

        for (const sgtin of invalidSgtins) {
            assert.throws(
                () => service.parseSgtin(sgtin),
                SgtinParseError,
                `Devrait rejeter: ${sgtin}`
            );
        }
    });
});

describe('Check Digit Calculation', () => {

    it('calcule le check digit pour un GTIN-13 Michelin', () => {
        // GTIN-14 base: 0 + 086699 + 988229 = 0086699988229
        // Check digit attendu: 0
        const base = '0086699988229';
        const checkDigit = service.calculateCheckDigit(base);
        assert.equal(checkDigit, 0);
    });

    it('calcule le check digit pour différents GTIN', () => {
        // Exemples connus
        const testCases = [
            { base: '629104150021', expected: 3 }, // GTIN-13: 6291041500213
            { base: '001234567890', expected: 5 }, // Test générique
        ];

        for (const { base, expected } of testCases) {
            const result = service.calculateCheckDigit(base);
            assert.equal(result, expected, `Base ${base} devrait donner ${expected}`);
        }
    });
});

describe('SGTIN to GTIN-13 Conversion', () => {

    it('convertit un SGTIN Michelin en GTIN-13', () => {
        const sgtin = 'urn:epc:id:sgtin:086699.0988229.72916502389';
        const parsed = service.parseSgtin(sgtin);
        const gtin13 = service.sgtinToGtin13(parsed);

        // GTIN-13 attendu: 0866999882290
        assert.equal(gtin13, '0866999882290');
        assert.equal(gtin13.length, 13);
    });

    it('convertit différents SGTINs correctement', () => {
        // Le GTIN-13 est calculé automatiquement avec check digit
        // Vérifier uniquement que le résultat a 13 caractères et est cohérent
        const sgtin = 'urn:epc:id:sgtin:086699.0762575.63647563790';
        const parsed = service.parseSgtin(sgtin);
        const gtin13 = service.sgtinToGtin13(parsed);

        assert.equal(gtin13.length, 13);
        // Le GTIN doit contenir le company prefix
        assert.ok(gtin13.includes('086699'), 'Doit contenir le company prefix');
    });
});

describe('GTIN to FQDN Conversion', () => {

    it('convertit un GTIN-13 en FQDN testing', () => {
        const gtin = '0866999882290';
        const fqdn = service.gtinToFqdn(gtin);

        // Chiffres inversés + suffix
        const expected = '0.9.2.2.8.8.9.9.9.6.6.8.0.gtin.gs1.id.testing.gdso.org';
        assert.equal(fqdn, expected);
    });

    it('génère un FQDN de 13 chiffres séparés', () => {
        const gtin = '1234567890123';
        const fqdn = service.gtinToFqdn(gtin);

        // Vérifier le format : 13 chiffres + gtin.gs1.id.testing.gdso.org = 19 parts
        const parts = fqdn.split('.');
        // 13 chiffres + "gtin" + "gs1" + "id" + "testing" + "gdso" + "org" = 19
        assert.ok(parts.length >= 18, `FQDN devrait avoir au moins 18 parts, a ${parts.length}`);
        assert.ok(fqdn.includes('gtin.gs1.id'), 'Doit contenir gtin.gs1.id');
    });
});

describe('Full SGTIN to FQDN Pipeline', () => {

    it('traite un SGTIN Michelin complet', () => {
        const sgtin = 'urn:epc:id:sgtin:086699.0988229.72916502389';

        // Parse
        const parsed = service.parseSgtin(sgtin);
        assert.ok(parsed.companyPrefix);

        // GTIN
        const gtin13 = service.sgtinToGtin13(parsed);
        assert.equal(gtin13.length, 13);

        // FQDN
        const fqdn = service.gtinToFqdn(gtin13);
        assert.ok(fqdn.includes('gtin.gs1.id'));
        assert.ok(fqdn.includes('gdso.org'));
    });
});

console.log('✅ Tests SGTIN prêts à être exécutés avec: node --test tests/sgtin.test.js');
