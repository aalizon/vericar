# VériCar Europe — SaaS de vérification d’historique véhicule en Europe

**VériCar Europe** est une plateforme SaaS complète (équivalent CarVertical orienté Europe & France) combinant le **décodage VIN ISO 3779**, l’interrogation en direct de **registres Open Data officiels** (Pays-Bas RDW, RappelConso DGCCRF France, NHTSA vPIC & Recalls), la **fusion gratuite de rapports HistoVec**, un système de **crédits & facturation Stripe / Sandbox**, des **liens de partage vérifiés sans PII** et une **console d’administration**.

---

## Fonctionnalités principales

### 1. Parcours d’inspection & agrégation multi-pays
- **Pré-vérification gratuite (0 crédit)** (`/verifier`) : validation VIN ISO 3779 / plaque européenne, détection automatique du pays, aperçu des signaux et des registres disponibles avant tout débit.
- **Rapport véhicule complet en 9 sections** (`/rapport/:id`) :
  1. Synthèse, score de confiance 0–100, verdict & provenance exacte des sources.
  2. Historique kilométrique & détection automatique de recul compteur (graphique SVG interactif).
  3. Sinistres & schéma interactif carrosserie vue aérienne (pastilles cliquables + coûts estimés).
  4. Vol, gages, procédures VGE / VEI / WOK & badges honnêtes « vérifié » vs « non vérifié par cette source ».
  5. Contrôles techniques (CT / APK / MOT / TÜV) et défauts relevés.
  6. Rappels constructeur en direct (**RappelConso France DGCCRF** + **RDW** + **NHTSA**).
  7. Parcours européen & chronologie consolidée.
  8. Fiche technique, vignette **Crit’Air** et anatomie du VIN (WMI / VDS / VIS).
  9. Estimation de cote ajustée & arguments de négociation acheteur.
- **Import HistoVec & Kit Acheteur France (0 crédit)** (`/histovec`) : analyse texte libre ou JSON issu d’`histovec.interieur.gouv.fr`, fusion automatique avec le décodage VIN et RappelConso, plus générateur de message vendeur (HistoVec FR / Car-Pass BE).
- **Couverture européenne (12 registres)** (`/couverture`) : annuaire transparent des registres officiels (FR, NL, DE, BE, GB, IT, ES, PL, NO, SE, DK, EE).

### 2. Plateforme SaaS prête pour la mise en ligne
- **Comptes & sessions sécurisées** (`/connexion`, `/inscription`, `/compte`) : hachage `crypto.scrypt` avec sel unique, comparaison en temps constant, cookies `HttpOnly` + `SameSite=Lax`, protection CSRF par origine, changement de mot de passe invalidant les autres sessions.
- **Portefeuille de crédits & facturation** (`/tarifs`, `/compte/factures/:orderId`) :
  - 4 packs sans abonnement (`14,90 €` / `24,90 €` / `32,90 €` / `79,90 €` TTC), crédit de bienvenue configurable (`SIGNUP_BONUS_CREDITS=1`).
  - **Mode Stripe natif** (Checkout Sessions + vérification HMAC-SHA256 sur `POST /api/billing/webhook`, sans dépendance SDK externe) et **Mode Sandbox** automatiquement désactivé (`403`) dès qu’une clé Stripe est configurée.
  - Renonciation explicite au droit de rétractation (Art. L221-28 du Code de la consommation).
  - Garantie **« Vérification avant débit »** : aucun crédit débité si le registre échoue ou ne trouve rien ; réouverture gratuite à vie d’un véhicule déjà débloqué.
  - Factures TVA 20 % numérotées en JSON et HTML imprimable A4.
- **Bibliothèque, comparateur & partage vérifié** (`/mes-rapports`, `/r/:shareToken`) : recherche par marque/plaque/VIN, comparateur 2 véhicules côte à côte, activation/révocation de lien public vérifié en lecture seule sans exposer aucune donnée personnelle (PII).
- **Conformité RGPD & mentions légales** (`/mentions-legales`, `/cgu`, `/confidentialite`) : cookie strictement nécessaire uniquement, export JSON complet (`GET /api/account/export`), suppression définitive en cascade (`DELETE /api/account`).
- **Console d’administration** (`/admin`) : KPIs (utilisateurs, rapports, crédits en circulation, CA live vs sandbox séparés), télémétrie cache/connecteurs et attribution manuelle de crédits support.

---

## Architecture technique

- **Runtime** : Node.js 24 LTS (ESM), Express 4, SQLite natif (`node:sqlite` avec mode WAL et migrations automatiques idempotentes V1 → V3).
- **Frontend** : React 19, Vite 8, `lucide-react`, routeur SPA History API (`client/src/lib/router.jsx`), CSS Vanilla éditorial (`tokens.css`, `global.css`, `report.css`, `saas.css`), linter `oxlint`.
- **Tests** :
  - `server/tests/vericar.test.js` & `server/tests/saas-core.test.js` : 25 tests unitaires & intégration SaaS 100 % déterministes hors-ligne.
  - `server/tests/live.test.js` : 4 tests live opt-in contre les APIs Open Data officielles (`RDW`, `vPIC`, `RappelConso`).
  - `e2e/tests/tier1..4-*.test.js` : suite E2E Playwright Chromium headless couvrant tous les parcours utilisateur, facturation, partage public, RGPD et RBAC admin.

---

## Démarrage local rapide

```bash
# 1. Installer les dépendances (serveur + client)
npm run install:all

# 2. Copier la configuration exemple (optionnel en mode Sandbox local)
cp .env.example .env

# 3. Compiler le frontend et lancer le serveur de production sur http://localhost:3001
npm run build
npm start
```

Pour le développement avec rechargement à chaud (backend sur `:3001`, Vite proxy sur `:5173`) :
```bash
npm run dev:server
npm run dev:client
```

---

## Variables d’environnement principales (`.env.example`)

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `PORT` | `3001` | Port HTTP d’écoute |
| `DATA_DIR` / `DB_PATH` | `server/data/vericar.db` | Chemin de persistance SQLite (`/app/data` en Docker/PaaS) |
| `APP_URL` | `http://localhost:3001` | URL publique canonique (redirections Stripe & CORS) |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | *(vide)* | Bootstrap ou promotion d’un compte administrateur au démarrage |
| `SIGNUP_BONUS_CREDITS` | `1` | Nombre de crédits offerts à l’inscription |
| `STRIPE_SECRET_KEY` | *(vide)* | Active Stripe Checkout en production et désactive le mode Sandbox |
| `STRIPE_WEBHOOK_SECRET` | *(vide)* | Secret `whsec_...` pour signer `POST /api/billing/webhook` |
| `ALLOW_SANDBOX_BILLING` | `true` | Autorise les commandes de test tant que `STRIPE_SECRET_KEY` est absent |
| `UK_MOT_API_KEY` / `NO_VEGVESEN_API_KEY` | *(vide)* | Clés API gouvernementales gratuites (Royaume-Uni DVSA / Norvège) |

### Configuration du webhook Stripe (production)
1. Créez un endpoint webhook dans votre tableau de bord Stripe pointant vers `https://votre-domaine.tld/api/billing/webhook`.
2. Abonnez-le à l’événement `checkout.session.completed`.
3. Renseignez `STRIPE_SECRET_KEY=sk_live_...` (ou `sk_test_...`) et `STRIPE_WEBHOOK_SECRET=whsec_...` dans les variables d’environnement de votre hébergeur.

---

## Déploiement en production

Le dépôt inclut des manifestes prêts à l’emploi pour un déploiement en quelques minutes :

### Docker / Docker Compose (VPS ou cloud)
```bash
cp .env.example .env
# Éditez .env (APP_URL, ADMIN_EMAIL, ADMIN_PASSWORD, STRIPE_*)
docker compose up -d --build
```
La base SQLite est persistée dans le volume Docker `vericar_data` (`/app/data/vericar.db`).

### Railway
1. Connectez ce dépôt GitHub sur [railway.app](https://railway.app) (`railway.json` est détecté automatiquement).
2. Attachez un volume persistant monté sur `/app/data`.
3. Ajoutez `APP_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` (et `STRIPE_*` pour activer les paiements réels).

### Render
1. Importez le dépôt comme **Blueprint** sur [render.com](https://render.com) (`render.yaml` configure le conteneur Docker en région `frankfurt` avec un disque persistant `/app/data` sur plan `starter`).
2. Renseignez les secrets demandés (`APP_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `STRIPE_*`).

### Fly.io (région Paris `cdg`)
```bash
fly launch --no-deploy --region cdg
fly volumes create vericar_data --region cdg --size 1
fly secrets set APP_URL=https://vericar-europe.fly.dev ADMIN_EMAIL=admin@exemple.fr ADMIN_PASSWORD=MotDePasseFort123!
fly deploy
```

---

## Scripts de vérification & tests

```bash
npm run lint        # Lint React/JS (oxlint — 0 erreur, 0 warning)
npm run build       # Build Vite production (client/dist)
npm test            # 25 tests unitaires & SaaS API hors-ligne
npm run test:live   # 4 tests opt-in sur les APIs Open Data temps réel
npm run test:e2e    # Suite E2E 4-tiers Playwright Chromium headless
```
