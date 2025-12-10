/**
 * GDSO TIS API Server
 * Expose le client GDSO via REST API pour Fleet Manager Pro
 *
 * @module server
 * @author Ralph Achatz
 * @version 1.0.0
 */

import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { GdsoService } from './lib/gdso-service.js';
import { NaptrNotFoundError, SgtinParseError } from './lib/errors.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================================
// CONFIGURATION
// ============================================================================

const GDSO_ENV = process.env.GDSO_ENV || 'production';
const GDSO_API_SECRET = process.env.GDSO_API_SECRET;

// Domaines autorisés pour CORS
const ALLOWED_ORIGINS = [
    /\.supabase\.co$/,
    /\.achatz\.fr$/,
    /^http:\/\/localhost(:\d+)?$/,
    /^http:\/\/127\.0\.0\.1(:\d+)?$/
];

// ============================================================================
// MIDDLEWARE
// ============================================================================

// CORS configuration
app.use(cors({
    origin: (origin, callback) => {
        // Autoriser les requêtes sans origin (curl, Postman, etc.)
        if (!origin) return callback(null, true);

        const isAllowed = ALLOWED_ORIGINS.some(pattern => {
            if (pattern instanceof RegExp) return pattern.test(origin);
            return origin === pattern;
        });

        if (isAllowed) {
            callback(null, true);
        } else {
            console.warn(`[CORS] Origine refusée: ${origin}`);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true
}));

// Parse JSON body
app.use(express.json({ limit: '1mb' }));

// Servir les fichiers statiques (robots.txt)
app.use(express.static(join(__dirname, 'public')));

// Logging middleware
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            method: req.method,
            path: req.path,
            status: res.statusCode,
            duration_ms: duration,
            ip: req.ip || req.headers['x-forwarded-for']
        }));
    });
    next();
});

// Auth middleware (protège les endpoints /api/*)
const authMiddleware = (req, res, next) => {
    // Pas de protection si secret non configuré (dev local)
    if (!GDSO_API_SECRET) {
        console.warn('[AUTH] GDSO_API_SECRET non configuré - API non protégée!');
        return next();
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
            success: false,
            error: 'UNAUTHORIZED',
            message: 'Header Authorization: Bearer {token} requis'
        });
    }

    const token = authHeader.substring(7);
    if (token !== GDSO_API_SECRET) {
        return res.status(403).json({
            success: false,
            error: 'FORBIDDEN',
            message: 'Token invalide'
        });
    }

    next();
};

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Parse commercialNameLongDescription pour extraire load_index et speed_symbol
 * Exemples de formats:
 * - "385/55R22.5 X MULTI T2 TL 160K VG MI" -> 160, K
 * - "315/70R22.5 KMAX D G2 154L152M 3PSF" -> 154, L (premier indice)
 * - "315/80 R22.5 156/150K" -> 156, K (double indice avec slash)
 * - "295/60R22.5 150/147L" -> 150, L
 *
 * @param {string} commercialName - Nom commercial du pneu
 * @returns {{ load_index: number|null, speed_symbol: string|null }}
 */
function parseSpecifications(commercialName) {
    if (!commercialName) return { load_index: null, speed_symbol: null };

    // Pattern 1: Format "154L152M" - double indice avec lettres (Goodyear style)
    // [ACEFGHJKLMNPQSTUVWYZ] = lettres de vitesse valides (excluant R/B/D)
    let match = commercialName.match(/\b(\d{2,3})([ACEFGHJKLMNPQSTUVWYZ])(\d{2,3})([ACEFGHJKLMNPQSTUVWYZ])\b/);
    if (match) {
        return {
            load_index: parseInt(match[1], 10),
            speed_symbol: match[2]
        };
    }

    // Pattern 2: Format "156/150K" - double indice avec slash
    match = commercialName.match(/\b(\d{2,3})\/(\d{2,3})([ACEFGHJKLMNPQSTUVWYZ])\b/);
    if (match) {
        return {
            load_index: parseInt(match[1], 10),
            speed_symbol: match[3]
        };
    }

    // Pattern 3: Format simple "160K" - doit être un espace avant ou début de string
    // et pas après une dimension (ex: 70R22)
    match = commercialName.match(/(?:^|\s)(\d{2,3})([ACEFGHJKLMNPQSTUVWYZ])(?:\s|$)/);
    if (match) {
        return {
            load_index: parseInt(match[1], 10),
            speed_symbol: match[2]
        };
    }

    return { load_index: null, speed_symbol: null };
}

/**
 * Extrait la dimension du pneu depuis le nom commercial ou les données
 * @param {Object} tireData - Données brutes du pneu
 * @returns {string|null}
 */
function extractDimension(tireData) {
    // Essayer d'abord depuis les données structurées
    if (tireData?.product?.dimensions) {
        const d = tireData.product.dimensions;
        if (d.sectionWidth && d.aspectRatio && d.rimDiameter) {
            const construction = d.constructionType || 'R';
            return `${d.sectionWidth}/${d.aspectRatio}${construction}${d.rimDiameter}`;
        }
    }

    // Sinon extraire depuis le nom commercial
    const name = tireData?.product?.commercialNameLongDescription ||
                 tireData?.product?.commercialName || '';

    // Pattern dimension: 385/55R22.5, 315/80R22.5, 295/60R22.5, etc.
    const match = name.match(/(\d{2,3}\/\d{2,3}[RBD]?\d{2}(?:\.\d)?)/i);
    return match ? match[1].toUpperCase() : null;
}

/**
 * Formate la réponse API pour un pneu
 * @param {Object} result - Résultat brut de GdsoService
 * @returns {Object}
 */
function formatTireResponse(result) {
    const tireData = result.data;

    // Cas: fabricant sans API GDSO
    if (!tireData) {
        return {
            sgtin: result.sgtin,
            manufacturer: result.manufacturer,
            gtin13: result.gtin13,
            available: false,
            error: result.error || 'NO_DATA'
        };
    }

    const commercialName = tireData?.product?.commercialNameLongDescription ||
                          tireData?.product?.commercialName || null;
    const specs = parseSpecifications(commercialName);
    const dimension = extractDimension(tireData);

    return {
        sgtin: result.sgtin,
        manufacturer: result.manufacturer,
        gtin13: result.gtin13,
        available: true,
        brand_name: tireData?.product?.brandName || null,
        commercial_name: commercialName,
        dimension: dimension,
        load_index: specs.load_index,
        speed_symbol: specs.speed_symbol,
        dot_tin: tireData?.dotTin?.weekYear || null,
        country_of_origin: tireData?.countryOfOrigin || null,
        raw_data: tireData
    };
}

// ============================================================================
// ROUTES
// ============================================================================

// Health check (non protégé)
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        environment: GDSO_ENV,
        version: '1.0.0'
    });
});

// Info API (non protégé)
app.get('/', (req, res) => {
    res.json({
        name: 'GDSO TIS API',
        version: '1.0.0',
        description: 'API REST pour récupérer les informations des pneus via GDSO',
        endpoints: {
            'GET /health': 'Health check',
            'POST /api/gdso/tire': 'Récupère les infos d\'un pneu (body: { sgtin_urn })',
            'POST /api/gdso/batch': 'Récupère les infos de plusieurs pneus (body: { sgtin_urns: [...] }, max 100)'
        },
        documentation: 'https://gdso-org.github.io/tech-doc/'
    });
});

// POST /api/gdso/tire - Info pneu unique
app.post('/api/gdso/tire', authMiddleware, async (req, res) => {
    try {
        const { sgtin_urn } = req.body;

        if (!sgtin_urn || typeof sgtin_urn !== 'string') {
            return res.status(400).json({
                success: false,
                error: 'BAD_REQUEST',
                message: 'Body doit contenir { sgtin_urn: "urn:epc:id:sgtin:..." }'
            });
        }

        const service = new GdsoService({
            environment: GDSO_ENV,
            verbose: false,
            jsonLogs: true,
            useCache: true
        });

        const result = await service.getTireInfo(sgtin_urn);

        res.json({
            success: true,
            data: formatTireResponse(result)
        });

    } catch (error) {
        console.error('[ERROR]', error.message);

        // Gestion des erreurs spécifiques
        if (error instanceof SgtinParseError) {
            return res.status(400).json({
                success: false,
                error: 'INVALID_SGTIN',
                message: error.message
            });
        }

        if (error instanceof NaptrNotFoundError) {
            // Fabricant sans API GDSO configurée
            return res.json({
                success: true,
                data: {
                    sgtin: req.body.sgtin_urn,
                    manufacturer: 'Unknown',
                    available: false,
                    error: 'NAPTR_NOT_FOUND'
                }
            });
        }

        res.status(500).json({
            success: false,
            error: 'INTERNAL_ERROR',
            message: error.message
        });
    }
});

// POST /api/gdso/batch - Batch (max 100 UIIs)
app.post('/api/gdso/batch', authMiddleware, async (req, res) => {
    try {
        const { sgtin_urns } = req.body;

        if (!Array.isArray(sgtin_urns) || sgtin_urns.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'BAD_REQUEST',
                message: 'Body doit contenir { sgtin_urns: ["urn:epc:id:sgtin:...", ...] }'
            });
        }

        if (sgtin_urns.length > 100) {
            return res.status(400).json({
                success: false,
                error: 'PAYLOAD_TOO_LARGE',
                message: 'Maximum 100 UIIs par requête'
            });
        }

        const service = new GdsoService({
            environment: GDSO_ENV,
            verbose: false,
            jsonLogs: true,
            useCache: true
        });

        const results = await service.getTireInfoBatch(sgtin_urns);

        res.json({
            success: true,
            count: results.length,
            data: results.map(formatTireResponse)
        });

    } catch (error) {
        console.error('[ERROR]', error.message);

        if (error instanceof SgtinParseError) {
            return res.status(400).json({
                success: false,
                error: 'INVALID_SGTIN',
                message: error.message
            });
        }

        res.status(500).json({
            success: false,
            error: 'INTERNAL_ERROR',
            message: error.message
        });
    }
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: 'NOT_FOUND',
        message: `Route ${req.method} ${req.path} non trouvée`
    });
});

// Error handler global
app.use((err, req, res, next) => {
    console.error('[ERROR]', err);
    res.status(500).json({
        success: false,
        error: 'INTERNAL_ERROR',
        message: err.message || 'Erreur interne du serveur'
    });
});

// ============================================================================
// START SERVER
// ============================================================================

app.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔═══════════════════════════════════════════════════════════╗
║                  GDSO TIS API Server                      ║
╠═══════════════════════════════════════════════════════════╣
║  Port:         ${PORT.toString().padEnd(40)}║
║  Environment:  ${GDSO_ENV.padEnd(40)}║
║  Protected:    ${(GDSO_API_SECRET ? 'Yes' : 'No (set GDSO_API_SECRET!)').padEnd(40)}║
╚═══════════════════════════════════════════════════════════╝
    `);
});
