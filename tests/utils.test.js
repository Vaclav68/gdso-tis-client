/**
 * Tests unitaires - Utilitaires (Cache, Retry)
 *
 * @run node --test tests/utils.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { withRetry, LRUCache, sleep, formatDuration, truncate } from '../lib/utils.js';
import { RetryExhaustedError } from '../lib/errors.js';

describe('LRUCache', () => {

    it('stocke et récupère une valeur', () => {
        const cache = new LRUCache({ maxSize: 10 });
        cache.set('key1', 'value1');

        assert.equal(cache.get('key1'), 'value1');
    });

    it('retourne undefined pour clé inexistante', () => {
        const cache = new LRUCache();
        assert.equal(cache.get('nonexistent'), undefined);
    });

    it('respecte la taille maximale (éviction LRU)', () => {
        const cache = new LRUCache({ maxSize: 3 });

        cache.set('a', 1);
        cache.set('b', 2);
        cache.set('c', 3);
        cache.set('d', 4); // Doit évincer 'a'

        assert.equal(cache.get('a'), undefined);
        assert.equal(cache.get('b'), 2);
        assert.equal(cache.get('c'), 3);
        assert.equal(cache.get('d'), 4);
        assert.equal(cache.size, 3);
    });

    it('met à jour la position LRU lors de get()', () => {
        const cache = new LRUCache({ maxSize: 3 });

        cache.set('a', 1);
        cache.set('b', 2);
        cache.set('c', 3);

        // Accéder à 'a' le remet en fin de liste
        cache.get('a');

        cache.set('d', 4); // Doit évincer 'b' (le plus ancien non accédé)

        assert.equal(cache.get('a'), 1);
        assert.equal(cache.get('b'), undefined);
    });

    it('expire les entrées selon le TTL', async () => {
        const cache = new LRUCache({ ttlMs: 50 }); // 50ms TTL

        cache.set('key', 'value');
        assert.equal(cache.get('key'), 'value');

        await sleep(100); // Attendre expiration

        assert.equal(cache.get('key'), undefined);
    });

    it('vérifie has() correctement', () => {
        const cache = new LRUCache();

        cache.set('exists', 'yes');

        assert.equal(cache.has('exists'), true);
        assert.equal(cache.has('notexists'), false);
    });

    it('supprime une entrée avec delete()', () => {
        const cache = new LRUCache();

        cache.set('key', 'value');
        assert.equal(cache.has('key'), true);

        cache.delete('key');
        assert.equal(cache.has('key'), false);
    });

    it('vide le cache avec clear()', () => {
        const cache = new LRUCache();

        cache.set('a', 1);
        cache.set('b', 2);
        cache.clear();

        assert.equal(cache.size, 0);
    });

    it('retourne les stats correctement', () => {
        const cache = new LRUCache({ maxSize: 100, ttlMs: 60000 });

        cache.set('a', 1);
        cache.set('b', 2);

        const stats = cache.stats();
        assert.equal(stats.size, 2);
        assert.equal(stats.maxSize, 100);
        assert.equal(stats.ttlMs, 60000);
    });
});

describe('withRetry', () => {

    it('retourne le résultat si succès immédiat', async () => {
        const result = await withRetry(() => Promise.resolve('success'));
        assert.equal(result, 'success');
    });

    it('retry après échec puis succès', async () => {
        let attempts = 0;

        const result = await withRetry(async () => {
            attempts++;
            if (attempts < 2) {
                throw new Error('Fail');
            }
            return 'success';
        }, {
            maxAttempts: 3,
            delayMs: 10,
            shouldRetry: () => true  // Toujours retry pour ce test
        });

        assert.equal(result, 'success');
        assert.equal(attempts, 2);
    });

    it('lance RetryExhaustedError après max attempts', async () => {
        let attempts = 0;

        await assert.rejects(
            async () => {
                await withRetry(
                    async () => {
                        attempts++;
                        throw new Error('Always fail');
                    },
                    {
                        maxAttempts: 3,
                        delayMs: 10,
                        operationName: 'test',
                        shouldRetry: () => true  // Toujours retry pour ce test
                    }
                );
            },
            RetryExhaustedError
        );

        assert.equal(attempts, 3);
    });

    it('appelle onRetry callback', async () => {
        const retryCalls = [];

        await assert.rejects(
            async () => {
                await withRetry(
                    async () => { throw new Error('Fail'); },
                    {
                        maxAttempts: 3,
                        delayMs: 10,
                        shouldRetry: () => true,  // Toujours retry pour ce test
                        onRetry: (attempt, delay) => {
                            retryCalls.push({ attempt, delay });
                        }
                    }
                );
            },
            RetryExhaustedError
        );

        assert.equal(retryCalls.length, 2); // 2 retries après le premier échec
        assert.equal(retryCalls[0].attempt, 1);
    });

    it('respecte shouldRetry', async () => {
        let attempts = 0;

        await assert.rejects(
            async () => {
                await withRetry(
                    async () => {
                        attempts++;
                        const err = new Error('No retry');
                        err.code = 'NO_RETRY';
                        throw err;
                    },
                    {
                        maxAttempts: 5,
                        delayMs: 10,
                        shouldRetry: (err) => err.code !== 'NO_RETRY'
                    }
                );
            },
            Error
        );

        assert.equal(attempts, 1); // Pas de retry car shouldRetry = false
    });
});

describe('Helper Functions', () => {

    it('sleep attend le temps spécifié', async () => {
        const start = Date.now();
        await sleep(50);
        const elapsed = Date.now() - start;

        assert.ok(elapsed >= 45, `Devrait attendre ~50ms, a attendu ${elapsed}ms`);
    });

    it('formatDuration formate correctement', () => {
        assert.equal(formatDuration(500), '500ms');
        assert.equal(formatDuration(1500), '1.5s');
        assert.equal(formatDuration(90000), '1.5min');
    });

    it('truncate tronque les longues chaînes', () => {
        const long = 'a'.repeat(200);
        const result = truncate(long, 50);

        assert.equal(result.length, 50);
        assert.ok(result.endsWith('...'));
    });

    it('truncate ne modifie pas les courtes chaînes', () => {
        const short = 'hello';
        assert.equal(truncate(short, 50), 'hello');
    });
});

console.log('✅ Tests Utils prêts à être exécutés avec: node --test tests/utils.test.js');
