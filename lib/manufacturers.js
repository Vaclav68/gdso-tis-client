/**
 * Configuration des fabricants GDSO
 * Source: https://gdso.org/About-us/Our-members
 * Company Prefix trouvés via GS1 et bases de données UPC
 *
 * Membres GDSO: Bridgestone, Continental, Giti, Goodyear, Hankook,
 * Kumho, Michelin, Nexen, Pirelli, Prometeon, Sumitomo, Toyo, Yokohama
 */

export const MANUFACTURERS = {
    // ========================================================================
    // MICHELIN GROUP
    // ========================================================================
    '086699': {
        name: 'Michelin',
        country: 'FR',
        urlPattern: '{baseUrl}/tire/{sgtin}',
        encodeSgtin: true,
        headers: {},
        transformResponse: null
    },

    // ========================================================================
    // CONTINENTAL AG
    // ========================================================================
    '051324': {
        name: 'Continental',
        country: 'DE',
        urlPattern: '{baseUrl}/{sgtin}',
        encodeSgtin: true,
        headers: {},
        transformResponse: null
    },
    '051342': {
        name: 'Continental',
        country: 'US',
        urlPattern: '{baseUrl}/{sgtin}',
        encodeSgtin: true,
        headers: {},
        transformResponse: null
    },
    '4019238': {
        name: 'Continental',
        country: 'DE',
        urlPattern: '{baseUrl}/{sgtin}',
        encodeSgtin: true,
        headers: {},
        transformResponse: null
    },

    // ========================================================================
    // PIRELLI
    // ========================================================================
    '8019227': {
        name: 'Pirelli',
        country: 'IT',
        urlPattern: '{baseUrl}/{sgtin}',
        encodeSgtin: true,
        headers: {},
        transformResponse: null
    },

    // ========================================================================
    // GOODYEAR
    // ========================================================================
    '697662': {
        name: 'Goodyear',
        country: 'US',
        urlPattern: '{baseUrl}/tire/{sgtin}',
        encodeSgtin: true,
        headers: {},
        transformResponse: null
    },
    '019502': {
        name: 'Goodyear',
        country: 'US',
        urlPattern: '{baseUrl}/tire/{sgtin}',
        encodeSgtin: true,
        headers: {},
        transformResponse: null
    },

    // ========================================================================
    // BRIDGESTONE
    // ========================================================================
    '019343': {
        name: 'Bridgestone',
        country: 'JP',
        urlPattern: '{baseUrl}/tire/{sgtin}',
        encodeSgtin: true,
        headers: {},
        transformResponse: null
    },
    '4902027': {
        name: 'Bridgestone',
        country: 'JP',
        urlPattern: '{baseUrl}/tire/{sgtin}',
        encodeSgtin: true,
        headers: {},
        transformResponse: null
    },

    // ========================================================================
    // HANKOOK (Korea - 880 prefix)
    // ========================================================================
    '8801954': {
        name: 'Hankook',
        country: 'KR',
        urlPattern: '{baseUrl}/{sgtin}',
        encodeSgtin: true,
        headers: {},
        transformResponse: null
    },

    // ========================================================================
    // KUMHO (Korea - 880 prefix)
    // ========================================================================
    '8801956': {
        name: 'Kumho',
        country: 'KR',
        urlPattern: '{baseUrl}/{sgtin}',
        encodeSgtin: true,
        headers: {},
        transformResponse: null
    },

    // ========================================================================
    // YOKOHAMA (Japan - 490 prefix)
    // ========================================================================
    '4907587': {
        name: 'Yokohama',
        country: 'JP',
        urlPattern: '{baseUrl}/tire/{sgtin}',
        encodeSgtin: true,
        headers: {},
        transformResponse: null
    },

    // ========================================================================
    // SUMITOMO / FALKEN / DUNLOP (Japan)
    // ========================================================================
    '4981910': {
        name: 'Sumitomo (Falken/Dunlop)',
        country: 'JP',
        urlPattern: '{baseUrl}/tire/{sgtin}',
        encodeSgtin: true,
        headers: {},
        transformResponse: null
    },

    // ========================================================================
    // TOYO TIRES (Japan - 45x/49x prefix)
    // TODO: Company prefix à confirmer avec un vrai pneu RFID
    // ========================================================================
    '4571271': {
        name: 'Toyo Tires',
        country: 'JP',
        urlPattern: '{baseUrl}/tire/{sgtin}',
        encodeSgtin: true,
        headers: {},
        transformResponse: null
    },

    // ========================================================================
    // NEXEN (Korea)
    // ========================================================================
    '8807622': {
        name: 'Nexen',
        country: 'KR',
        urlPattern: '{baseUrl}/{sgtin}',
        encodeSgtin: true,
        headers: {},
        transformResponse: null
    },

    // ========================================================================
    // GITI (Singapore/China)
    // ========================================================================
    '6924064': {
        name: 'Giti',
        country: 'SG',
        urlPattern: '{baseUrl}/{sgtin}',
        encodeSgtin: true,
        headers: {},
        transformResponse: null
    },

    // ========================================================================
    // PROMETEON (ex-Pirelli Industrial)
    // ========================================================================
    '8019205': {
        name: 'Prometeon',
        country: 'IT',
        urlPattern: '{baseUrl}/{sgtin}',
        encodeSgtin: true,
        headers: {},
        transformResponse: null
    }
};

/**
 * Configuration par défaut pour les fabricants inconnus
 */
export const DEFAULT_MANUFACTURER = {
    name: 'Unknown',
    // Essayer plusieurs patterns
    urlPatterns: [
        '{baseUrl}/{sgtin}',
        '{baseUrl}/tire/{sgtin}',
        '{baseUrl}/tyre/{sgtin}'
    ],
    encodeSgtin: true,
    headers: {},
    transformResponse: null
};

/**
 * Obtient la configuration d'un fabricant par son company prefix
 */
export function getManufacturerConfig(companyPrefix) {
    return MANUFACTURERS[companyPrefix] || {
        ...DEFAULT_MANUFACTURER,
        name: `Unknown (${companyPrefix})`
    };
}

/**
 * Construit l'URL de l'API pour un fabricant donné
 */
export function buildApiUrl(baseUrl, sgtin, manufacturerConfig) {
    const pattern = manufacturerConfig.urlPattern || manufacturerConfig.urlPatterns?.[0];
    const encodedSgtin = manufacturerConfig.encodeSgtin
        ? encodeURIComponent(sgtin)
        : sgtin;

    // Normaliser l'URL de base
    const normalizedBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;

    return pattern
        .replace('{baseUrl}', normalizedBase)
        .replace('{sgtin}', encodedSgtin);
}

/**
 * Génère toutes les URLs possibles pour un fabricant inconnu
 */
export function buildAllPossibleUrls(baseUrl, sgtin, manufacturerConfig) {
    const patterns = manufacturerConfig.urlPatterns || [manufacturerConfig.urlPattern];
    const normalizedBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    const urls = [];

    for (const pattern of patterns) {
        // Avec encodage
        urls.push(pattern
            .replace('{baseUrl}', normalizedBase)
            .replace('{sgtin}', encodeURIComponent(sgtin)));

        // Sans encodage
        urls.push(pattern
            .replace('{baseUrl}', normalizedBase)
            .replace('{sgtin}', sgtin));
    }

    return [...new Set(urls)]; // Dédupliquer
}
