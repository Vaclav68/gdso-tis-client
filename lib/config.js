/**
 * Configuration centrale GDSO TIS
 * Source: https://gdso-org.github.io/tech-doc/
 * Supporte les environnements Testing et Production
 */

export const ENVIRONMENTS = {
    testing: {
        name: 'Testing',
        auth: {
            // Solution 2: API System-to-System (Basic Auth)
            tokenUrl: 'https://authentication-api.testing.gdso.org/getIdToken',

            // Solution 1: OpenID Connect (Cognito)
            cognito: {
                domain: 'https://fuqzxw2k75c49t2fdn.auth.eu-central-1.amazoncognito.com',
                clientId: '3661gkmsqil29qtb24rvq3o4tb',
                // Client secret pour Authorization Code Flow
                clientIdAuthCode: '64v14gunpd9hicf4ufk67tav8j',
                clientSecret: '4a8ajiv33tbkvqzt9wa8gs2qe16hb1w863z1yx6g604l0bnqtd0w',
                scope: 'openid',
                userPoolId: 'eu-central-1_yIbrF9hG3'
            },

            // JWKS pour validation des tokens
            jwksUrl: 'https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_yIbrF9hG3/.well-known/jwks.json'
        },
        ons: {
            suffix: 'gtin.gs1.id.testing.gdso.org',
            dnsResolver: 'https://dns.google/resolve'
        }
    },
    production: {
        name: 'Production',
        auth: {
            // Solution 2: API System-to-System (Basic Auth)
            tokenUrl: 'https://authentication-api.gdso.org/getIdToken',

            // Solution 1: OpenID Connect (Cognito)
            cognito: {
                domain: 'https://fuqzxw2k75c49t2.auth.eu-central-1.amazoncognito.com',
                authorizeUrl: 'https://fuqzxw2k75c49t2.auth.eu-central-1.amazoncognito.com/oauth2/authorize',
                clientId: '', // Contacter info@gdso.org pour obtenir
                scope: 'openid',
                userPoolId: 'eu-central-1_X79w26IDV',
                openIdConfig: 'https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_X79w26IDV/.well-known/openid-configuration'
            },

            // JWKS pour validation des tokens
            jwksUrl: 'https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_X79w26IDV/.well-known/jwks.json'
        },
        ons: {
            suffix: 'gtin.gs1.id.gdso.org',
            dnsResolver: 'https://dns.google/resolve'
        }
    }
};

/**
 * Obtient la configuration de l'environnement actuel
 */
export function getEnvironmentConfig(env = 'testing') {
    return ENVIRONMENTS[env] || ENVIRONMENTS.testing;
}

/**
 * Configuration des timeouts (en ms)
 */
export const TIMEOUTS = {
    auth: 10000,      // 10 secondes pour l'auth
    api: 30000,       // 30 secondes pour les appels API
    dns: 5000         // 5 secondes pour le DNS
};

/**
 * Configuration du retry
 */
export const RETRY = {
    maxAttempts: 3,
    delayMs: 1000,
    backoffMultiplier: 2
};
