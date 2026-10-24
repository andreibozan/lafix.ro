# Launch gates — LaFix

## Activări necesare înainte de orice cont real

- [ ] Identitate operator legal, CUI, adresă și informații de contact publicate.
- [ ] Termeni servicii, politică confidențialitate/GDPR, temei colectare și perioade retenție, procedură drepturi persoane vizate.
- [ ] Cloudflare D1 creat și migrat într-un mediu staging/production distinct, backup/restore probat.
- [ ] Expeditor Resend verificat, anti-abuz, rate limiting testat și e-mail de verificare/recuperare testat.
- [ ] Cloudflare Access cu MFA pentru zona admin și acțiuni sensibile.
- [ ] Audit securitate/CSRF/XSS/autorizări pe conturi diferite; alertare erori, mediu staging separat.
- [ ] Profil prestator și servicii verificate manual, categorii/arie active reale.
- [ ] Flux cap-coadă pe Chrome/Safari/telefon și accesibilitate.

## Înainte de prima plată

- [ ] Entitate comercială și cont bancar compatibile Stripe, KYC aprobat.
- [ ] Tarif Pro comunicat explicit (RON, perioadă, cu/fără TVA, beneficii), taxe clarificate cu contabilul.
- [ ] Plan/preț Stripe real configurat; webhook și Customer Portal testate cu plăți test-mode.
- [ ] Sistem de facturare și conformare RO e-Factura după caz; politica de anulări, rambursare și litigii.
- [ ] Idempotency și ordine evenimente Stripe verificate în mediu real; monitoring și reconciliere periodică.
- [ ] Beneficiile Pro există efectiv și sunt explicate fără garantarea lead-urilor; `billing_enabled` poate trece la 1 doar după toate verificările.

## Etape următoare

1. Notificări prestator și clienți pentru oferte/atribuirile noi.
2. Mesagerie și upload securizat cu stocare privată.
3. Cazuri de dispută și politică moderare; plăți pentru lucrări doar după model comercial final.
4. Aplicatie mobilă unificată client/prestator, testată iOS/Android.
5. Paginare, analitice și raportare financiară, SEO pentru zone reale active.
