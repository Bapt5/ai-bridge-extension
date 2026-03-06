# AI Bridge — Firefox Extension

**Transférez n'importe quelle conversation IA vers un autre provider en un clic.**

Vous avez commencé une longue conversation sur Gemini et vous voulez continuer sur Claude ? AI Bridge extrait l'historique complet, génère un prompt d'import prêt à coller, et conserve le contexte d'un bout à l'autre.

---

## Installer l'extension

### Pour les utilisateurs

La façon la plus simple : télécharger la dernière version signée depuis les **[Releases GitHub](../../releases/latest)**.

1. Télécharger le fichier `ai-bridge-vX.X.X.xpi` depuis la page Release
2. Dans Firefox : **Menu (☰) → Modules complémentaires et thèmes → ⚙ → Installer depuis un fichier…**
3. Sélectionner le `.xpi` téléchargé → **Ajouter**

L'extension est installée de façon permanente et survit aux redémarrages de Firefox.

> Le `.xpi` est signé automatiquement par Mozilla à chaque release — Firefox l'accepte sans manipulation supplémentaire.

---

### Pour les développeurs et contributeurs

1. Cloner le dépôt :
   ```bash
   git clone https://github.com/Bapt5/ai-bridge-extension.git
   cd ai-bridge-extension
   ```
2. Ouvrir Firefox → `about:debugging` → **"Ce Firefox"**
3. Cliquer **"Charger un module complémentaire temporaire…"**
4. Sélectionner `manifest.json` à la racine du projet

L'extension est active jusqu'à la fermeture de Firefox. Après chaque modification du code, cliquer **"Recharger"** dans `about:debugging`.

---

## Utilisation

1. Ouvrir une conversation sur ChatGPT, Gemini ou Claude
2. Cliquer sur l'icône **AI Bridge** dans la barre d'outils Firefox
3. Cliquer **"Extraire la conversation"**
4. Copier le prompt généré et le coller dans le provider cible

L'extension mémorise la dernière extraction par conversation — pas besoin de ré-extraire à chaque ouverture du popup.

---

## Fonctionnement

### Providers supportés

| Provider | Extraction | Méthode |
|---|---|---|
| **Gemini** | ✅ Complète | API interne — tous les messages, même les plus anciens |
| **ChatGPT** | ✅ Complète | DOM + scroll automatique |
| **Claude** | ✅ Complète | DOM + scroll automatique |
| **Copilot** | 🟡 Best-effort | DOM |
| **Perplexity** | 🟡 Best-effort | DOM |
| **Mistral** | 🟡 Best-effort | DOM |
| **Poe** | 🟡 Best-effort | DOM |

> **✅ Complète** = sélecteurs vérifiés sur des exports HTML réels.  
> **🟡 Best-effort** = sélecteurs génériques, peuvent casser si l'UI change.

### Ce que fait l'extension

1. Détecte automatiquement le provider depuis l'URL
2. Extrait la conversation complète (scroll ou appel API selon le provider)
3. Affiche un aperçu avec statistiques (nombre de messages, user/IA)
4. Génère un prompt d'import prêt à coller dans le provider cible
5. Mémorise l'extraction par URL — pas besoin de ré-extraire à chaque ouverture du popup

### Format de sortie

```
Moi : [message utilisateur]

IA : [réponse de l'IA]

Moi : ...
```

Le prompt final inclut le titre, le provider source et l'historique complet pour que le nouvel assistant reprenne le contexte naturellement.

---

## CI/CD — Build et release automatiques

Chaque release est construite et signée automatiquement par GitHub Actions via `web-ext sign`.

### Publier une nouvelle version

```bash
git tag v1.2.0
git push origin v1.2.0
```

C'est tout. Le workflow `.github/workflows/release.yml` :
1. Met à jour la version dans `manifest.json` avec le tag
2. Soumet l'extension à Mozilla pour signature automatique (*unlisted*)
3. Publie le `.xpi` signé dans une GitHub Release

### Configurer les secrets (une seule fois)

Dans les **Settings → Secrets and variables → Actions** du dépôt, ajouter :

| Secret | Où le trouver |
|---|---|
| `AMO_JWT_ISSUER` | [addons.mozilla.org/fr/developers/addon/api/key](https://addons.mozilla.org/fr/developers/addon/api/key/) |
| `AMO_JWT_SECRET` | Même page |

---

## Structure du projet

```
ai-bridge-extension/
├── .github/
│   └── workflows/
│       └── release.yml        # CI/CD : signature + release automatique
├── manifest.json              # Manifest v2 (Firefox/Gecko)
├── content/
│   └── extractor.js           # Content script — extraction par provider
├── popup/
│   ├── popup.html             # Interface du popup
│   └── popup.js               # Logique du popup (extraction, copie, persistance)
├── background/
│   └── background.js          # Background script — copie clipboard
└── icons/
    ├── icon48.png
    └── icon96.png
```

### Flux de données

```
[Page IA] ←→ extractor.js (content script)
                    ↕ messages (browser.runtime)
              popup.js (popup)
                    ↕ copyToClipboard
              background.js
```

---

## Contribuer

### Ajouter le support d'un nouveau provider

Tout se passe dans `content/extractor.js`.

**1. Déclarer le provider**

```js
const PROVIDERS = {
  // ...
  "chat.nouveauprovider.com": "NouveauProvider",
};
```

**2. Ajouter le domaine dans `manifest.json`**

```json
"matches": [
  "*://chat.nouveauprovider.com/*"
]
```

**3. Écrire la fonction d'extraction**

```js
function extractNouveauProvider() {
  const messages = [];
  // Inspecter le DOM avec les DevTools pour trouver les bons sélecteurs
  // Idéalement : exporter la page en HTML et analyser hors-ligne
  document.querySelectorAll('[data-role="user"]').forEach(el => {
    messages.push({ role: "user", text: el.textContent.trim() });
  });
  // idem pour les messages IA
  return messages;
}
```

**4. Brancher dans `extractConversation()`**

```js
else if (hostname.includes("chat.nouveauprovider.com"))
  messages = extractNouveauProvider();
```

**5. Gérer le titre dans `getConversationTitle()`** si `document.title` ne suffit pas.

### Trouver les bons sélecteurs

1. Ouvrir la conversation dans Firefox
2. **Sauvegarder la page complète** (Ctrl+S → "Page Web, complète")
3. Analyser le HTML hors-ligne avec BeautifulSoup ou les DevTools
4. Préférer les attributs stables : `data-testid`, `data-role`, `data-author`, custom elements
5. Éviter les classes CSS générées (ex : `_3kFdJ`) — elles changent à chaque déploiement

> Pour les providers qui virtualisent les messages, chercher dans l'onglet **Réseau** des DevTools un endpoint qui retourne l'historique complet — c'est la technique utilisée pour Gemini (`batchexecute?rpcids=hNvQHb`).

### Réparer un provider cassé

Les providers mettent à jour leur UI régulièrement. Si l'extraction retourne 0 messages :

1. Ouvrir les DevTools sur la page du provider
2. Inspecter un message utilisateur et un message IA
3. Trouver l'attribut qui les distingue de façon stable
4. Mettre à jour la fonction `extract<Provider>()` correspondante
5. Tester sur une conversation courte, puis longue

### Personnaliser le prompt par défaut

Le template est dans `popup/popup.js`, constante `DEFAULT_PROMPT_TEMPLATE`. Variables disponibles :

| Variable | Valeur |
|---|---|
| `{{provider}}` | Nom du provider source (ex : `Gemini`) |
| `{{title}}` | Titre de la conversation |
| `{{conversation}}` | Historique formaté `Moi : ...\n\nIA : ...` |

### Bonnes pratiques

- **Aucune dépendance externe** — uniquement les APIs WebExtension standard
- **Aucun réseau sortant** sauf l'appel API Gemini (cookies de session existants, aucune donnée transmise à un tiers)
- **Aucun stockage long terme** — le cache par URL est dans `storage.local`, effaçable depuis les paramètres Firefox
- Tester sur Firefox ≥ 78

---

## Limitations connues

- **Gemini > 100 messages** : l'API est appelée avec `count=100`. La pagination n'est pas implémentée.
- **ChatGPT Projects** : le titre peut ne pas être détecté si la sidebar diffère des conversations classiques.
- **Providers best-effort** : Copilot, Perplexity, Mistral et Poe ne sont pas vérifiés sur des exports réels — contributions bienvenues.
- **Chrome/Edge** : l'extension utilise `browser.*` (Firefox). Une adaptation `chrome.*` est possible mais non testée.

---

## Licence

MIT © 2026 [Bapt5](https://github.com/Bapt5)
