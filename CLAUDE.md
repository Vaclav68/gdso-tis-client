# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

GDSO (Global Data Service Organisation) - Standard industriel pour récupérer les informations des pneus via RFID (SGTIN-96).

**Documentation officielle:** https://gdso-org.github.io/tech-doc/

## Architecture GDSO - Flux Complet

```
┌─────────────────────────────────────────────────────────────┐
│  1. RÉSOLUTION ONS (DNS NAPTR)                              │
│                                                             │
│  SGTIN → GTIN-13 → FQDN inversé → DNS NAPTR → URL API       │
│                                                             │
│  Exemple:                                                   │
│  urn:epc:id:sgtin:086699.0762575.xxx                        │
│  → GTIN-13: 0866997625752                                   │
│  → FQDN: 2.5.7.5.2.6.7.9.9.6.6.8.0.gtin.gs1.id.testing...   │
│  → API: https://indus.api.michelin.com/tid-ultim-v1/gdso/   │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  2. AUTHENTIFICATION                                        │
│                                                             │
│  Solution A (Simple): API Basic Auth                        │
│  POST authentication-api.testing.gdso.org/getIdToken        │
│  Header: Authorization: Basic base64(user:pass)             │
│  → Retourne: JWT Token directement                          │
│                                                             │
│  Solution B (OAuth): Cognito OpenID Connect                 │
│  Domain: fuqzxw2k75c49t2fdn.auth.eu-central-1.amazoncognito │
│  Client ID: 3661gkmsqil29qtb24rvq3o4tb                      │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  3. APPEL API FABRICANT                                     │
│                                                             │
│  GET {manufacturer_url}/tire/{sgtin}                        │
│  Header: Authorization: Bearer {jwt_token}                  │
│                                                             │
│  POST {manufacturer_url}/tires  (batch, max 100 UIIs)       │
│  Body: ["urn:epc:id:sgtin:...", "urn:epc:id:sgtin:..."]     │
└─────────────────────────────────────────────────────────────┘
```

## Conversion SGTIN → GTIN (Algorithme)

1. **Parser le SGTIN**: `urn:epc:id:sgtin:<prefix>.<indicator_item>.<serial>`
2. **Construire GTIN-14**: indicator + prefix + item_ref + check_digit
3. **GTIN-13**: Retirer le premier caractère du GTIN-14
4. **FQDN**: Inverser les chiffres, séparer par des points, ajouter suffix

```
Check digit = (10 - (Σ digits × alternating 3,1)) % 10
```

## Configuration Environnements

### Testing
| Service | URL |
|---------|-----|
| Auth API | `https://authentication-api.testing.gdso.org/getIdToken` |
| Cognito | `https://fuqzxw2k75c49t2fdn.auth.eu-central-1.amazoncognito.com` |
| Client ID | `3661gkmsqil29qtb24rvq3o4tb` |
| ONS Suffix | `gtin.gs1.id.testing.gdso.org` |
| JWKS | `https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_yIbrF9hG3/.well-known/jwks.json` |

### Production
| Service | URL |
|---------|-----|
| Auth API | `https://authentication-api.gdso.org/getIdToken` |
| ONS Suffix | `gtin.gs1.id.gdso.org` |
| JWKS | `https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_X79w26IDV/.well-known/jwks.json` |

## Fabricants GDSO (Company Prefix GS1)

### Membres GDSO avec API connue
| Company Prefix | Fabricant | Pays | API Testing |
|----------------|-----------|------|-------------|
| 086699 | **Michelin** | FR | `indus.api.michelin.com` |
| 051324, 051342 | **Continental** | DE/US | `qal.tdp.azure.continental.cloud` |
| 8019227 | **Pirelli** | IT | `dev-api.pirelli.com` |

### Autres membres GDSO (API via ONS)
| Company Prefix | Fabricant | Pays |
|----------------|-----------|------|
| 019343, 4902027 | Bridgestone | JP |
| 697662, 019502 | Goodyear | US |
| 8801954 | Hankook | KR |
| 8801956 | **Kumho** | KR |
| 4907587 | Yokohama | JP |
| 4981910 | Sumitomo (Falken/Dunlop) | JP |
| 8807622 | Nexen | KR |
| 6924064 | Giti | SG |
| 8019205 | Prometeon | IT |

> **Note**: Les Company Prefix coréens commencent par `880`, japonais par `49`, italiens par `80`

## Structure du Projet

```
GDSO/
├── gdso.js              # CLI principal (scalable)
├── gdso-client.js       # Client complet (legacy)
├── gdso-ons-resolver.js # Résolveur ONS seul
├── lib/
│   ├── config.js        # Configuration environnements
│   ├── manufacturers.js # Config par fabricant
│   └── gdso-service.js  # Service principal
├── .env                 # Credentials (non versionné)
└── gdso_standard_api_v2.1.0.yaml  # Spec OpenAPI
```

## Commandes

```bash
# CLI scalable (recommandé)
node gdso.js "urn:epc:id:sgtin:086699.0762575.63647563790"
node gdso.js --batch "uIIS de test"
node gdso.js --env production "urn:epc:id:sgtin:..."

# Client legacy
node gdso-client.js "urn:epc:id:sgtin:..."

# ONS uniquement (pas d'auth)
node gdso-ons-resolver.js "urn:epc:id:sgtin:..."
```

## Configuration (.env)

```bash
# Testing (actif)
GDSO_USERNAME=ralph.achatz.fr
GDSO_PASSWORD=788078807880Aa!

# Production (en attente de validation - demande envoyée le 02/12/2024)
# GDSO_PROD_USERNAME=???
# GDSO_PROD_PASSWORD=???
```

## Comptes GDSO

| Environnement | Portail | Username | Status |
|---------------|---------|----------|--------|
| Testing | https://manage.testing.gdso.org | ralph.achatz.fr | Actif |
| Production | https://manage.gdso.org | ??? | En attente (Kbis envoyé) |

## Conversion EPC Hex → SGTIN

Pour convertir un code EPC lu par scanner RFID (ex: Unitech P902) :

```bash
# EPC Hex: 301854AAC3C51150FA1A5D84
# → SGTIN: urn:epc:id:sgtin:086699.0988229.72915508612
# → Fabricant: Michelin
# → GTIN-13: 0866999882290
```

Le header `0x30` = SGTIN-96. Partition 6 = Company Prefix 6 digits.

## API Endpoints (Standard GDSO)

| Endpoint | Méthode | Description |
|----------|---------|-------------|
| `/tire/{sgtin}` | GET | Info pneu unique |
| `/tires` | POST | Batch (max 100 UIIs) |

**Headers requis:**
- `Authorization: Bearer {token}` (données privées)
- `Accept: application/json`

## Données Retournées

```typescript
interface Tire {
  uii: string;                    // SGTIN-96
  product: {
    brandName: string;            // Michelin, Continental...
    commercialName: string;       // Nom produit
    dimensions: { ... };          // Taille, largeur, ratio
    specifications: { ... };      // Indice charge/vitesse
    markings: { ... };            // M+S, 3PMSF, OE
    labelling: { ... };           // Étiquette énergie EU
  };
  dotTin: { weekYear: string };   // Date production
  countryOfOrigin: string;        // ISO 3 lettres
}
```

## Contact

- **GDSO**: info@gdso.org
- **Documentation**: https://gdso-org.github.io/tech-doc/
- **API Spec**: https://gdso-org.github.io/standard-api/
