# LaFix

Website de prezentare pentru viitoarea platformă de servicii locale LaFix. Această etapă publică un **preview static** și nu oferă încă solicitări reale, autentificare, înscrieri sau rezervări.

## Publicare gratuită — Cloudflare Pages

Repository: `andreibozan/lafix.ro`  
Ramura de producție: `main`

În **Cloudflare → Workers & Pages → proiect → Settings → Builds** folosește:

| Setare | Valoare |
| --- | --- |
| Framework preset | None |
| Root directory | `/` (implicit, rădăcina repository-ului) |
| Build command | `exit 0` |
| Build output directory | `apps/site` |
| Production branch | `main` |
| Environment variables | Niciuna necesară pentru această pagină statică |

Asigură-te că integrarea GitHub este conectată la acest repository și că **automatic production branch deployments** este activată. Cloudflare creează URL-ul `*.pages.dev` doar după un deployment reușit; nu presupune URL-ul după numele repository-ului.

## Structură

- `apps/site/index.html` — pagina publică;
- `apps/site/styles.css` — design responsive;
- `apps/site/favicon.svg` — pictograma;
- `apps/site/_headers` — antete de securitate aplicate de Cloudflare Pages.

Aceleași fișiere există temporar și în rădăcină, pentru compatibilitate cu deployment-urile care au fost configurate acolo. **Sursa recomandată pentru publicare este `apps/site`.** Modificările viitoare ale paginii trebuie făcute în `apps/site` (sau sincronizate explicit cu versiunile din rădăcină).

## Verificare

După deploy:
1. Verifică URL-ul de producție afișat în Cloudflare Pages — nu inventa un subdomeniu.
2. Confirmă că pagina se afișează, iar stylesheet-ul și favicon-ul se încarcă.
3. Verifică că statusul deploymentului este **Success** și ramura este **main**.
4. Site-ul conține intenționat `noindex,nofollow` cât timp este doar preview. Înainte de lansarea comercială, stabilim datele operatorului, contact real, pagini legale, flux real de solicitări și apoi activăm indexarea SEO.

## Dezvoltare locală

```bash
cd apps/site
python3 -m http.server 8080
```

Apoi deschide http://localhost:8080.

## Următorii pași MVP

Implementare backend + bază de date, autentificare client/prestator, catalog și zone active, trimitere solicitări, ofertare, moderare și dashboard admin. Website-ul static nu înlocuiește aceste funcționalități.

## Actualizare vizuală și acoperire — 24 octombrie 2026

- Nu mai prezentăm județul Hunedoara ca arie exclusivă. Comunicarea de lansare se referă la **întreaga Românie**, fără a promite că serviciile sunt deja active în fiecare localitate.
- Ilustrația SVG cu locuințe a fost recuperată din exportul original al site-ului LaFix și este disponibilă în `apps/site/illustrations/locuinte-lafix.svg`.
- Imaginea este folosită în secțiunea principală; toate resursele referite (`index.html`, `styles.css`, `favicon.svg`, `main.js`, imaginea SVG) există în directorul `apps/site`.
- Nu au fost găsite alte fișiere imagine în starterul Codex `lafix-2-codex-v5.zip`; pentru alte ilustrații create separat în Codex trebuie adăugate fișierele originale.
- Schimbările din GitHub pot declanșa deployment automat **doar dacă** Cloudflare Pages este conectat la ramura `main` și deploymentul automat este activ. Starea publicării se verifică în dashboard, nu se presupune din simpla existență a commitului.
