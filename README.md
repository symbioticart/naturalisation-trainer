# Naturalisation Interview Trainer

Two services to deploy on Render:

## 1. Proxy (Web Service)
Directory: `proxy/`

### Render setup:
- **Type**: Web Service
- **Build Command**: `npm install`
- **Start Command**: `npm start`
- **Environment Variables**:
  - `NOTION_TOKEN` = your Notion integration token (starts with `ntn_...`)
  - `NOTION_PAGE_ID` = `343dcfeccc3b80dcb2a9eff3a74ff792`

## 2. Frontend (Static Site)
Directory: `frontend/`

### Render setup:
- **Type**: Static Site
- **Publish Directory**: `frontend` (or just `.` if deploying only the frontend folder)

## After deployment:
1. Open the frontend app
2. Go to **Settings** tab
3. Enter your **Proxy URL** (from Render, e.g. `https://nat-proxy.onrender.com`)
4. Enter your **Claude API key** (starts with `sk-ant-...`)
5. Click **Save settings**
6. Click **Test connection** to verify

## Notion Page Structure

Structure your Notion page like this:

```
## Questions

### Présentez-vous
RU: Представьтесь
Chunks: architecte, Peillon, Tatiana, Solaris, municipalités
Variation A: Je m'appelle Nikolai. Je suis architecte...
RU: Меня зовут Николай...
Variation B: Je m'appelle Nikolai Grigoriev. Je suis architecte de formation...
RU: Меня зовут Николай Григорьев...
Variation C: Nikolai Grigoriev. Architecte. Peillon.
RU: Николай Григорьев. Архитектор. Пейон.
Follow-up: Que fait exactement votre start-up ?
Follow-up: Que faisiez-vous avant ?

### Pourquoi voulez-vous devenir citoyen français ?
...

## Facts
Président de la France - Emmanuel Macron
Premier ministre - Sébastien Lecornu
Devise - Liberté, Égalité, Fraternité
...

## Personal context
Nikolai Grigoriev, architecte, vit à Peillon depuis 2022...
```

## Progress
- Saved automatically in browser localStorage
- Export/Import as JSON from the Progress tab
- Spaced repetition tracks when to review each question
