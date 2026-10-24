# LaFix — platformă servicii: backend, administrare și billing (staging)

**Stare:** implementare de dezvoltare, testată local cu SQLite + integrare API simulată. **NU este publicată și NU este aprobată pentru utilizare în producție sau pentru încasări reale.** Website-ul public existent din `andreibozan/lafix.ro` nu trebuie suprascris automat până la configurarea serviciilor.

## Ce include

- Cloudflare Worker API + D1: autentificare passwordless cu e-mail (Resend), cookie HttpOnly Secure, limitare încercări, sesiuni și separare admin.
- Categorii servicii pentru toată România; profiluri prestatori cu categorii/județe și aprobare/suspendare.
- Cereri ale clienților, potrivire manuală cu maximum trei prestatori pe cerere, oferte de preț în RON, acceptare exclusivă, lucrări, finalizare și recenzii.
- Sesizări suport, administrarea categoriilor/utilizatorilor, auditul schimbărilor.
- `/admin.html` — dashboard funcțional **după activarea D1 și autentificării**.
- `/cont.html` — acces client/prestator cu solicitări, oferte, acceptări, profil și abonament.
- Stripe Checkout pentru abonamente Pro, Stripe Customer Portal, webhook cu validare semnătură/replay protection; activarea încasărilor este oprită implicit.
- Teste Node pentru flux complet și webhook Stripe.

## O schemă simplă de monetizare

- **Client:** solicitări gratuite la început; plata lucrării se face direct prestatorului, nu prin LaFix.
- **Prestator Free:** profil aprobat + invitații eligibile, fără taxă.
- **Prestator Pro (opțional):** prioritate la alocarea invitațiilor relevante în limita celor 3. Fără garanția unui număr de lead-uri sau a unor lucrări. Prețul trebuie stabilit de administrator în Stripe și afișat înainte de cumpărare. Nu seta un preț neconfirmat din documentație.
- Ulterior: pachete promovare și comisioane doar după validare juridică, contabilă și cu prestatori reali.

## Configurare staging, fără a afecta Worker-ul lafix-ro existent

1. Creează un proiect **nou de staging**, nu suprascrie `lafix-ro`.
2. Autentifică CLI: `npx wrangler login` (sau folosește o autentificare Cloudflare autorizată). **Nu lipi tokenuri în chat / GitHub.**
3. Creează o bază D1 dedicată: `npx wrangler d1 create lafix-marketplace-staging --location eeur`.
4. Copiază `wrangler.marketplace.example.toml` în `wrangler.marketplace.toml`, completează `database_id` cu UUID real obținut. Acest fișier nu se comite dacă are configurații private.
5. Aplică migrațiile staging: `npx wrangler d1 migrations apply lafix-marketplace-staging --remote --config wrangler.marketplace.toml`.
6. Configurează secrete **numai în Cloudflare**, nu în git:
   - `AUTH_PEPPER`: secret aleatoriu de minimum 32 octeți;
   - `RESEND_API_KEY`: cheia Resend și `AUTH_FROM_EMAIL`: adresă expeditor verificată;
   - `APP_ORIGIN`: URL-ul real HTTPS de staging;
   - pentru Stripe: `STRIPE_SECRET_KEY`, `STRIPE_PRICE_PRO`, `STRIPE_WEBHOOK_SECRET` (inițial **test mode**). Secretele de plăți pot rămâne neconfigurate.
   Folosește `npx wrangler secret put NUME --config wrangler.marketplace.toml` pentru fiecare valoare.
7. Publică staging: `npx wrangler deploy --config wrangler.marketplace.toml`. Cloudflare va afișa URL-ul real.
8. Testează `GET /api/health`, `GET /api/catalog` și login prin cod e-mail la `cont.html`.
9. Promovează o adresă e-mail autentificată drept admin **exclusiv din CLI sau dashboard securizat**, folosind parametrul e-mail real: `UPDATE users SET is_admin=1 WHERE email='adresa verificată';` în D1 staging. Nu există endpoint public de promovare. Restricționează suplimentar `/admin.html`, `/admin.js` și `/api/admin/*` prin Cloudflare Zero Trust Access cu MFA înainte de accesul real.
10. Verifică prin două conturi diferite: aprobă prestator, publică cerere, matching, oferă, acceptă, finalizează și lasă recenzie.
11. Configurează webhook Stripe **numai după verificarea contului Stripe** cu endpoint-ul `https://URL_STAGING/api/stripe/webhook`; selectează `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`. Testează plăți și anulări. Setarea `billing_enabled` rămâne `0` până la activarea explicită de către admin.
12. Pentru productie: baza D1 separată, backup, monitorizare, proceduri de ștergere a datelor, GDPR, facturare și taxare, politică servicii, termeni contractuali, contact/operator publicat, verificare securitate, MFA și teste pe dispozitive reale.

## Rulare teste locale

Node.js **22.16+** (folosește `node:sqlite`, experimental în Node 22):

```bash
node --test tests/marketplace.test.mjs
node --check apps/api/worker.mjs
node --check apps/site/admin.js
node --check apps/site/portal.js
```

Testează codul logic și SQL-ul într-un SQLite local, nu confirmă automat comportamentul D1 remote, Stripe live, e-mail, Cloudflare Access sau deploy. Pentru verificare Workers/D1 exactă este necesar un test staging cu Wrangler.

## Limitări intenționate / lucruri neactivate

- Niciun cont Cloudflare, D1, Resend sau Stripe nu este conectat prin conversație; nicio plată reală, notificare de potrivire sau cont admin nu este creat pe server.
- Aplicația Expo din starter nu este integrată cu acest Worker; designul mobile și fluxurile sale necesită API client și teste separate.
- Matching-ul este administrat manual, nu se trimit notificări de cerere; prestatorii verifică invitațiile în portal.
- Mesageria între părți, încărcarea fișierelor, moderarea recenziilor, plățile pentru lucrări, decontările, sistemul de reclamații complexe și instrumentele avansate de retenție nu sunt implementate.
- Dashboard-ul raportează doar ultimele 100 de înregistrări din fiecare listă, nu analytics complete; sunt necesare filtre, căutare și paginare pentru scalare.
- În producție sunt obligatorii evaluare de securitate și configurarea Cloudflare Access/MFA pentru admin. Nu activezi monetizarea dacă nu există beneficiile promise și documentele legale.

## Structură

`apps/api/worker.mjs` — API; `infra/d1/0001_core.sql` — tabele; `apps/site/admin.html` + `admin.js` — dashboard; `apps/site/cont.html` + `portal.js` + `portal.css` — fluxuri utilizatori; `wrangler.marketplace.example.toml` — config staging; `tests/marketplace.test.mjs` — smoke/E2E local.
