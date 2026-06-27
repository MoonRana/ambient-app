# CME Phase 2 — Accreditation Path

v1 ships **self-tracked** CME activity in the mobile app (Consult searches + Freestyle tidbits). Credits are **not** board-recognized until Phase 2.

## Recommended path

1. **Partner with an ACCME-accredited CME provider** (fastest)
   - Provider issues Category 1 credit for logged activities
   - DoMyNote supplies activity data + attestation records from `cme_activities`

2. **Apply for ACCME accreditation** (slower, full control)
   - Requires compliance infrastructure, commercial support disclosure, outcomes measurement

## Board mapping (display labels in v1)

| User board | Typical acceptance |
|------------|-------------------|
| ABIM | MOC / CME from ACCME Category 1 or POCE programs |
| ABFM | MC-FP credit from accredited providers |
| ANCC / AANP | Contact hours from accredited providers |
| NCCPA | Category 1 CME from accredited providers |

## Data we already log (v1)

- `cme_activities`: topic, credits, attestation timestamp, source refs, job/consult IDs
- Consult: 0.5 hr per claimed search
- Freestyle tidbits: 0.25 hr per checked pearl

## Next steps (business)

- [ ] Identify CME partner (e.g. medical society, CME vendor)
- [ ] Legal review of attestation copy and certificate wording
- [ ] Decide on paid subscription gate for CME (OpenEvidence-style)
- [ ] Optional: post-test or reflection requirement per partner rules

## Technical follow-up after partner sign

- Export API or scheduled reports for partner
- Certificate PDF with partner branding + ACCME activity number
- Block marketing as "Category 1" until partner approval
