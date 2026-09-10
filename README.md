# Wayne Gang — Cabo Weekend Drink Games

A standalone web app (no Claude, no backend server you have to run) for tracking
the 5 weekend drink games. It talks directly to your Firebase project
(`cabo-de506`) for shared, real-time data across everyone's phones.

## One-time setup (do this before the trip)

### 1. Turn on Firestore in your Firebase project

1. Go to https://console.firebase.google.com and open the **cabo-de506** project.
2. In the left sidebar, click **Build → Firestore Database**.
3. Click **Create database**. Choose **Start in production mode** (we'll set our
   own rules next), pick any region, and confirm.

### 2. Set the security rules

1. Still in Firestore Database, click the **Rules** tab.
2. Delete whatever's there and paste in the contents of `firestore.rules`
   (included in this folder).
3. Click **Publish**.

This makes the `logs` collection open to anyone with the app link (there's no
login system, so this is intentional) and locks down everything else. Fine for
a private group app — just don't post the link publicly.

### 3. Push this code to your GitHub repo

From inside this folder:

```bash
git init
git add .
git commit -m "Wayne Gang app"
git branch -M main
git remote add origin <your-repo-url>
git push -u origin main
```

## Deploying it (pick one)

### Option A — Firebase Hosting (recommended, since you already have Firebase)

```bash
npm install -g firebase-tools
firebase login
firebase init hosting
```

When it asks:
- **Public directory:** enter `.` (this folder, since there's no build step)
- **Single-page app rewrite:** No
- **Set up automatic builds with GitHub:** optional, up to you

Then deploy:

```bash
firebase deploy --only hosting
```

You'll get a real URL like `https://cabo-de506.web.app` — that's the link
everyone opens on their phone.

### Option B — GitHub Pages

1. In your GitHub repo, go to **Settings → Pages**.
2. Under "Build and deployment," set Source to **Deploy from a branch**,
   branch `main`, folder `/ (root)`.
3. Save. GitHub gives you a URL like `https://<you>.github.io/<repo>` within
   a few minutes.

Either option works the same way once live — it's just static files talking to
Firestore.

## Testing before the trip

Open the deployed link on two different phones (or a phone + your laptop in an
incognito window) and confirm that logging a drink on one shows up on the
other within a couple of seconds. This is the one thing worth actually
testing live, since it depends on your specific devices/network.

## What's in this app

- **Login** — name + room, remembered on that device from then on
- **Games screen** — the 5 drink games, big tap-to-log buttons
- **Leaderboard screen** — color-coded standings per game + a live named feed
- **Info screen** — itinerary, room rosters, how scoring works
- **Admin panel** — PIN `4210`, reachable from the bottom of the Info screen.
  Lets you undo/delete any log, manually adjust a room's count, or wipe a
  specific game's logs if something goes wrong.

## Editing content later

- **Rooms / members:** edit `ROOMS` in `data.js`
- **Games / shot roulette flavors:** edit `GAMES` in `data.js`
- **Admin PIN:** edit `ADMIN_PIN` in `data.js`
- **Itinerary text:** edit the "Itinerary" card directly in `index.html`
