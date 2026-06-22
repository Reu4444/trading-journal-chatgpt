# IBKR Trading Journal

Site HTML statique pour un journal de trading IBKR.

## Structure

```text
index.html
style.css
app.js
data/trades.json
scripts/fetch_ibkr.py
.github/workflows/update.yml
```

## Démarrage local

Ouvre `index.html` dans ton navigateur, ou lance un petit serveur local :

```bash
python -m http.server 8000
```

Puis ouvre :

```text
http://localhost:8000
```

## Publier sur GitHub Pages

1. Crée un repository GitHub.
2. Upload tous les fichiers.
3. Va dans `Settings > Pages`.
4. Source : `Deploy from a branch`.
5. Branche : `main`, dossier `/root`.
6. Sauvegarde.

## Automatisation IBKR

1. Dans IBKR Client Portal, crée une Flex Query avec tes trades / executions.
2. Récupère :
   - Flex token
   - Flex query ID
3. Dans GitHub :
   - `Settings > Secrets and variables > Actions`
   - Ajoute `IBKR_FLEX_TOKEN`
   - Ajoute `IBKR_FLEX_QUERY_ID`
4. Lance le workflow `Update IBKR Trading Journal`.

Important : ne jamais mettre ton token IBKR dans le code ou dans `trades.json`.
