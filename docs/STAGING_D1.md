# LaFix: mediu staging separat pe Cloudflare Workers + D1

Acest document descrie instalarea **staging**, NU activează servicii de producție. Ramura de cod este `feature/marketplace-admin-billing`. Worker-ul public existent `lafix-ro` și configurația lui `wrangler.toml` de pe `main` rămân neschimbate.

## Ce este automatizat

Fișierul `.github/workflows/deploy-marketplace-staging.yml` verifică sintaxa și testează backend-ul. Cu GitHub Actions secrets configurate, rulează `infra/scripts/provision-staging.mjs`, care:
1. identifică baza `lafix-marketplace-staging` în contul Cloudflare;
2. o creează doar dacă lipsește, cu jurisdicție de date UE;
3. generează local `wrangler.staging.generated.json` cu UUID-ul real (fișierul nu se comite);
4. aplică migrațiile SQL **doar** pe D1 staging;
5. publică Worker-ul distinct `lafix-marketplace-staging`;
6. verifică URL-ul real afișat de Wrangler, plus `/api/health`, `/api/catalog` și `/admin.html`.

Pe o execuție reușită, URL-ul verificat apare în rezumatul GitHub Actions. Nu îl presupunem în avans.

## Autorizarea Cloudflare necesară (2 secrete GitHub)

1. Cloudflare Dashboard → API Tokens → Create Token. Limitează tokenul la **contul tău Cloudflare**. Pentru prima creare Worker este necesar dreptul **Workers Admin** la nivel de produs; pentru D1 creare/migrare, drepturi D1 de administrare/editare. Nu folosi un token global cu acces nelimitat.
2. Copiază **Account ID** din Cloudflare Dashboard.
3. GitHub → repository `andreibozan/lafix.ro` → **Settings → Secrets and variables → Actions → New repository secret**:
   - `CLOUDFLARE_ACCOUNT_ID` — ID-ul contului;
   - `CLOUDFLARE_API_TOKEN` — tokenul limitat de mai sus.
4. După salvarea secretelor, declanșează **o nouă execuție** a workflow-ului printr-un nou push pe ramura `feature/marketplace-admin-billing`; poți cere actualizarea unui fișier de documentație în acea ramură. Workflow-ul rulează la push, nu are nevoie să fie mutat în `main`.

Nu trimite tokenuri, parole sau coduri 2FA în conversație, issue-uri GitHub sau fișiere versionate.

## Funcționalitatea disponibilă imediat după primul deploy

- Website-ul de staging și `admin.html` se încarcă din `apps/site`.
- `GET /api/health` validează conexiunea D1.
- `GET /api/catalog` folosește categoriile din D1.
- Baza este separată de datele reale; nu facem seed cu utilizatori reali.
- Loginul pe e-mail rămâne **dezactivat** până sunt definite secretele `AUTH_PEPPER`, `RESEND_API_KEY` și `AUTH_FROM_EMAIL` în **Worker-ul de staging**, cu expeditor verificat.
- Încasările reale rămân **dezactivate**, setarea D1 `billing_enabled = 0`. Cheile Stripe live nu se introduc în staging.

## Înainte de testele cu utilizatori reali

- Configurare Cloudflare Zero Trust Access cu MFA pentru `/admin.html`, `/admin.js`, `/api/admin/*`.
- Creare cont admin autentificat prin e-mail verificat, promovare doar manual în D1; niciodată endpoint public de admin bootstrap.
- Separare secrete per mediu (doar staging), e-mail Resend verificat și rate limiting audit.
- Teste de autorizare, CSRF, abuz și verificarea datelor personale.
- Înainte de testele Stripe, numai chei **test mode**, webhook semnat și Customer Portal verificat.
- Fără colectarea datelor reale ale clienților până la documente legale, GDPR și responsabil operator.

## Ce verifici când workflow-ul a rulat

În GitHub → **Actions** → **LaFix staging - D1 and Worker**:
- `Validate marketplace code` este verde;
- `Provision staging D1, migrate and publish separate Worker` este verde;
- Rezumatul conține URL-ul verificat;
- În Cloudflare → Workers & Pages există **lafix-marketplace-staging**, separat de **lafix-ro**;
- Cloudflare D1 listează baza **lafix-marketplace-staging**.

Dacă jobul de deploy afișează „Cloudflare neautorizat”, configurează cele două secrete; atunci repornește printr-un nou push. Nu modifica `wrangler.toml` de pe `main` pentru a încerca să remediezi staging.

Surse: https://developers.cloudflare.com/d1/reference/migrations/ , https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/ , https://developers.cloudflare.com/workers/authorization/
