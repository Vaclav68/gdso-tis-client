# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 📋 Project Overview

**GDSO (Global Data Service Organisation)** - Standard industriel pour récupérer les informations des pneus via RFID (SGTIN-96).

| Info | Valeur |
|------|--------|
| Version | 2.0.0 |
| Node.js | ≥18.0.0 |
| Dépendances | Aucune (fetch natif) |
| Tests | `node --test` (natif) |

## 🔗 Ressources GDSO

| Ressource | URL |
|-----------|-----|
| 📖 Documentation technique | https://gdso-org.github.io/tech-doc/ |
| 📖 Introduction | https://gdso-org.github.io/tech-doc/docs/intro |
| 📄 API Spec (OpenAPI) | https://gdso-org.github.io/standard-api/ |
| 🧪 Démo Testing | https://demo.testing.gdso.org/ |
| 🔐 Portail Testing | https://manage.testing.gdso.org/ |
| 🔐 Portail Production | https://manage.gdso.org/ |
| 📝 Inscription Testing | https://register.testing.gdso.org/ |
| 📝 Inscription Production | https://register.gdso.org/ |
| 📧 Support technique | info@gdso.org |

## 🏗️ Architecture GDSO - Flux Complet

```
┌─────────────────────────────────────────────────────────────┐
│  1. RÉSOLUTION ONS (DNS NAPTR)                              │
│                                                             │
│  SGTIN → GTIN-13 → FQDN inversé → DNS NAPTR → URL API       │
│                                                             │
│  Exemple:                                                   │
│  urn:epc:id:sgtin:086699.0988229.72916502389                │
│  → GTIN-13: 0866999882290                                   │
│  → FQDN: 0.9.2.2.8.8.9.9.9.6.6.8.0.gtin.gs1.id.gdso.org     │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  2. AUTHENTIFICATION                                        │
│                                                             │
│  API Basic Auth → JWT Token                                 │
│  POST https://authentication-api.gdso.org/getIdToken        │
│  Header: Authorization: Basic base64(user:pass)             │
│  → Retourne: JWT Token (valide 1h)                          │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  3. APPEL API FABRICANT                                     │
│                                                             │
│  ⚠️ IMPORTANT: Le format d'URL varie selon le fabricant !   │
│                                                             │
│  Michelin:    GET {baseUrl}/{sgtin}  (PAS de /tire/)        │
│  Autres:      GET {baseUrl}/tire/{sgtin}                    │
│                                                             │
│  Header: Authorization: Bearer {jwt_token}                  │
└─────────────────────────────────────────────────────────────┘
```

## 🔢 Conversion SGTIN → GTIN (Algorithme)

1. **Parser le SGTIN**: `urn:epc:id:sgtin:<prefix>.<indicator_item>.<serial>`
2. **Construire GTIN-14**: indicator + prefix + item_ref + check_digit
3. **GTIN-13**: Retirer le premier caractère du GTIN-14
4. **FQDN**: Inverser les chiffres, séparer par des points, ajouter suffix

```
Check digit = (10 - (Σ digits × alternating 3,1)) % 10
```

## ⚙️ Configuration Environnements

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

## 🏭 Fabricants GDSO (Company Prefix GS1)

### ✅ Fabricants testés et fonctionnels (Production)
| Company Prefix | Fabricant | URL Pattern | Encode | API |
|----------------|-----------|-------------|--------|-----|
| 086699 | **Michelin** | `{baseUrl}/{sgtin}` | Oui | `api.michelin.com` |
| 54520007 | **Goodyear** | `{baseUrl}/{sgtin}` | Non | `api-etrto.goodyear.eu` |

### ❌ Fabricants sans API GDSO
| Company Prefix | Fabricant | Pays | Raison |
|----------------|-----------|------|--------|
| 8808956, 8801956 | **Kumho** | KR | Full Member GDSO (Sept 2024), API TIS non configurée (NAPTR absent). RFID interne depuis 2013. Partenariat Beontag 2024 pour ESPR. |

### ⏳ Autres membres GDSO (à tester)
| Company Prefix | Fabricant | Pays |
|----------------|-----------|------|
| 051324, 051342 | Continental | DE/US |
| 8019227 | Pirelli | IT |
| 019343, 4902027 | Bridgestone | JP |
| 8801954 | Hankook | KR |
| 4907587 | Yokohama | JP |
| 8807622 | Nexen | KR |

> **Note**: Chaque fabricant a son propre format d'URL. Utiliser la résolution ONS pour découvrir l'API, puis ajuster `manufacturers.js`

## 📁 Structure du Projet

```
gdso-tis-client/
├── gdso.js                    # 🚀 CLI principal
├── gdso-ons-resolver.js       # 🔍 Résolveur ONS seul
├── lib/
│   ├── config.js              # ⚙️ Config environnements (Testing/Production)
│   ├── manufacturers.js       # 🏭 Config par fabricant (URL patterns)
│   ├── gdso-service.js        # 🔧 Service principal (classe GdsoService)
│   ├── errors.js              # ❌ Classes d'erreur typées
│   ├── utils.js               # 🛠️ Utilitaires (retry, cache LRU)
│   └── logger.js              # 📝 Logger structuré (console/JSON)
├── tests/
│   ├── sgtin.test.js          # 🧪 Tests parsing SGTIN
│   └── utils.test.js          # 🧪 Tests utilitaires
├── .env                       # 🔐 Credentials (non versionné)
├── .env.example               # 📋 Template credentials
└── gdso_standard_api_v2.1.0.yaml  # 📄 Spec OpenAPI GDSO
```

## 💻 Commandes

```bash
# CLI principal
node gdso.js "urn:epc:id:sgtin:086699.0762575.63647563790"
node gdso.js --env production "urn:epc:id:sgtin:..."
node gdso.js --batch "fichier_uiis.txt"

# ONS uniquement (pas d'auth)
node gdso-ons-resolver.js "urn:epc:id:sgtin:..."

# Tests
pnpm test              # Tous les tests
pnpm test:sgtin        # Tests parsing SGTIN
pnpm test:utils        # Tests utilitaires
```

## 🔐 Configuration (.env)

```bash
# Testing
GDSO_USERNAME=ralph.achatz.fr
GDSO_PASSWORD=********

# Production
GDSO_PROD_USERNAME=transports.achatz-businessdev
GDSO_PROD_PASSWORD=********
```

## 👤 Comptes GDSO

| Environnement | Portail | Username | Status |
|---------------|---------|----------|--------|
| Testing | https://manage.testing.gdso.org | ralph.achatz.fr | ✅ Actif |
| Production | https://manage.gdso.org | transports.achatz-businessdev | ✅ Actif (10/12/2024) |

## 🔄 Conversion EPC Hex → SGTIN

Pour convertir un code EPC lu par scanner RFID (ex: Unitech P902) :

```
EPC Hex: 301854AAC3C51150FA1A5D84
→ SGTIN: urn:epc:id:sgtin:086699.0988229.72915508612
→ Fabricant: Michelin
→ GTIN-13: 0866999882290
```

Le header `0x30` = SGTIN-96. Partition 6 = Company Prefix 6 digits.

## 📡 API Endpoints (Standard GDSO)

| Endpoint | Méthode | Description |
|----------|---------|-------------|
| `/tire/{sgtin}` | GET | Info pneu unique |
| `/tires` | POST | Batch (max 100 UIIs) |

**Headers requis:**
- `Authorization: Bearer {token}` (données privées)
- `Accept: application/json`

## 📦 Données Retournées

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

## 🆕 Améliorations v2.0.0

| Feature | Description |
|---------|-------------|
| 🔄 **Retry avec backoff** | Retries automatiques sur erreurs réseau (3 tentatives, backoff exponentiel) |
| 💾 **Cache ONS** | Cache LRU des résolutions DNS (500 entrées, TTL 1h) |
| ❌ **Erreurs typées** | Classes d'erreur spécifiques (`SgtinParseError`, `AuthenticationError`, etc.) |
| 📝 **Logging structuré** | Support console colorée et JSON pour monitoring |
| 📖 **JSDoc complet** | Types documentés pour IDE autocomplete |
| 🧪 **Tests unitaires** | Tests avec `node:test` natif |

## 🧪 Utilisation programmatique

```javascript
import { GdsoService } from './lib/gdso-service.js';

const service = new GdsoService({
    environment: 'production',
    verbose: true,
    useCache: true
});

// Un pneu
const result = await service.getTireInfo('urn:epc:id:sgtin:086699.0762575.63647563790');
console.log(result.data);

// Batch
const results = await service.getTireInfoBatch([...sgtins]);

// Stats cache
console.log(service.getCacheStats());
```

## 📞 Contact

- **GDSO**: info@gdso.org
- **Documentation**: https://gdso-org.github.io/tech-doc/
- **API Spec**: https://gdso-org.github.io/standard-api/
