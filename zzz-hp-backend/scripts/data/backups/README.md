# Calculator buff JSON backups

Timestamped full exports from local MySQL via `npm run export:calculator-buffs`.

Restore (upsert, not replace by default):

```powershell
cd zzz-hp-backend
node scripts/import-calculator-buffs.mjs --file scripts/data/backups/<file>.json
```

Use `--replace` only when you intentionally want the DB to match the backup exactly.
