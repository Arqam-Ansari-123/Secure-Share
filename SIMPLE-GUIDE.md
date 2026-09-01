# SecureShare — The Whole Thing, Explained Simply

From "I just cloned the repo on the server" to "it works", with the networking
told as a story.

**Genetech Solutions — Your AI Solution Partner**

---

## Contents

| Part | What it explains |
|---|---|
| 1 | [The one mix-up that causes all the confusion](#part-1--the-one-mix-up-that-causes-all-the-confusion) |
| 2 | [What the two folders are](#part-2--what-the-two-folders-are) |
| 3 | [A folder cannot serve itself](#part-3--a-folder-cannot-serve-itself) |
| 4 | [The office building story](#part-4--the-office-building-story) |
| 5 | [Journey 1 — an employee makes a secret](#part-5--journey-1--an-employee-makes-a-secret) |
| 6 | [Journey 2 — a client opens the link](#part-6--journey-2--a-client-opens-the-link) |
| 7 | [Your laptop vs the server](#part-7--your-laptop-vs-the-server-side-by-side) |
| 8 | [The `.env` file, line by line](#part-8--the-env-file-line-by-line) |
| 9 | [Deploy — from `git clone` to done](#part-9--deploy--from-git-clone-to-done) |
| 10 | [When it breaks](#part-10--when-it-breaks) |

---

# Part 1 — The one mix-up that causes all the confusion

You said:

> *"two folders public and staff created on npm run dev and the ports 5173 and 5174"*

Here is the thing: **that is not what happens.** Let us look at the actual
commands, straight out of `Frontend/package.json`:

```
  npm run dev      =  vite --mode staff
  npm run build    =  npm run build:public && npm run build:staff
```

Read those two lines carefully. They are completely different jobs.

```
  ┌─────────────────────────────────────────────────────────────┐
  │  npm run dev                                                │
  │                                                             │
  │  Starts ONE program that stays running.                     │
  │  Creates NO folders.                                        │
  │  Uses ONE port: 5173.                                       │
  │  Only used on YOUR LAPTOP. Never on the server.             │
  └─────────────────────────────────────────────────────────────┘

  ┌─────────────────────────────────────────────────────────────┐
  │  npm run build                                              │
  │                                                             │
  │  Runs for about a minute, writes TWO folders, then EXITS.   │
  │  Uses NO ports at all.                                      │
  │  This is what the server runs.                              │
  └─────────────────────────────────────────────────────────────┘
```

So:

- **`dev` gives you a port. It does not give you folders.**
- **`build` gives you folders. It does not give you a port.**

And **5174 is not a real thing.** There is no `5174` anywhere in this project.
Search the whole repo and you will not find it. It appeared because Vite is
configured for 5173, and when 5173 is already busy, Vite quietly says *"fine,
I'll take 5174"* and prints it. It is an accident, not a design.

**The real production ports are 4173 and 4174.** Different numbers, and they come
from somewhere else entirely — Part 3.

> ### Remember this one sentence
> **`npm run dev` = one server, no folders. `npm run build` = two folders, no server.**

---

# Part 2 — What the two folders are

Run `npm run build` and you get this:

```
Frontend/dist/
├── staff/     ← the app YOUR EMPLOYEES use
│   ├── index.html
│   └── assets/…
└── public/    ← the page YOUR CLIENTS see
    ├── index.html
    └── assets/…
```

They are **two different websites**, built from the same source code.

## Why two, and not one?

Because there are two completely different kinds of visitor:

```
  👨‍💼  YOUR EMPLOYEE                    👤  A CLIENT AT ANOTHER COMPANY
      Works at Genetech                     Never heard of your systems
      Has a password                        Has no account and never will
      Logs in                               Just clicks a link you emailed
      Creates secrets                       Opens it once, reads it, done
      Sees the dashboard                    Sees ONE page
      Sees the audit log
```

The employee needs a big app. The client needs one page. So the build makes one
of each.

## What is actually inside each folder

| | `dist/staff` | `dist/public` |
|---|---|---|
| Login page | ✅ | ❌ |
| Create a secret | ✅ | ❌ |
| Dashboard | ✅ | ❌ |
| Admin activity log | ✅ | ❌ |
| List of every internal API address | ✅ | ❌ |
| Reveal page `/s/<token>` | ✅ | ✅ |
| Submit page `/r/<token>` | ✅ | ✅ |

Notice the last two rows. **The staff folder contains the client pages too.**
That is deliberate — an employee can test their own link without leaving their
own app. It will matter in Part 7.

## How one source folder makes two different websites

There is one file with one line in it:

```
Frontend/.env         VITE_SURFACE=public
Frontend/.env.staff   VITE_SURFACE=staff
```

The build reads that line and decides what to include. In the code
([App.tsx:21](Frontend/src/App.tsx#L21)):

```jsx
const STAFF = import.meta.env.VITE_SURFACE === 'staff'

const StaffRoutes = STAFF ? lazy(() => import('./routes/staff')) : null
```

When `STAFF` is `false`, that whole staff module is unreachable, so the build
tool **deletes it from the output**. Not hides it — deletes it. It is not in the
file. A client cannot find it with the browser's developer tools, because there
is nothing to find.

> ### ⚠️ The trap that catches everyone
>
> Those two `.env` files hold no passwords. Nothing secret. One line each. So
> people delete them when tidying up, or forget to copy them to the server.
>
> **Then both builds produce the public folder.** Your employees open the staff
> website and see a page with no login on it. And nothing — not the build, not
> the logs, not the browser — says anything is wrong.
>
> This is why `Frontend/.env` and `Frontend/.env.staff` must be in git.

---

# Part 3 — A folder cannot serve itself

This is where 4173 and 4174 come from, and it is simpler than it sounds.

You have two folders full of files. Now imagine a browser in another country asks
for one of those files. **Who hands it over?**

A folder cannot do that. A folder just sits on a disk. You need a **program** that
listens and hands files out.

That program is called `serve`. You start one for each folder:

```
serve  dist/staff   →  now listening on port 4173
serve  dist/public  →  now listening on port 4174
```

**That is the entire origin of those two numbers.**

Not the folders. Not the domains. Not the `.env` file. A program started, and it
opened a port.

## The key idea: a port is not a place, it is a program

This is the mental model that fixes everything:

> A port does not exist until a program opens it.
> Two folders → two `serve` programs → two ports.

If you stop the program, the port is gone. If you start a third program, there is
a third port.

## Who starts them? PM2.

You do not type those commands by hand. **PM2** is a manager that starts programs
and keeps them running — even after a reboot. It reads
[`Frontend/ecosystem.config.cjs`](Frontend/ecosystem.config.cjs), which says:

```js
const STAFF_PORT  = 4173   // serves dist/staff
const PUBLIC_PORT = 4174   // serves dist/public
```

Then `pm2 start ecosystem.config.cjs` launches both, and `pm2 list` shows them:

```
│ secureshare-staff   │ online │
│ secureshare-public  │ online │
```

## Why 4173 and not 5173?

**No reason at all.** They are just numbers. 4173 happens to be the traditional
number for serving a finished build; 4174 is simply the next one free. You could
change them to 9001 and 9002 and everything would work.

But there is **one rule**, and breaking it is the most common mistake in this
whole deployment:

> ### The number is written in TWO files, and they must match
>
> ```
> Frontend/ecosystem.config.cjs   →  which port `serve` LISTENS on
> deploy/nginx.conf               →  which port nginx CONNECTS to
> ```
>
> **Nothing checks that they agree.** Change one and forget the other, and every
> page returns `502 Bad Gateway` — nginx knocking on a door with nobody behind it.

---

# Part 4 — The office building story

Now the networking. Here is the whole thing as a story.

## The building

Your server is **one office building** at one street address:

```
                    66.51.159.115
```

Inside that building, three teams are working. Each has a room number:

```
   ┌──────────────────────────────────────────────┐
   │            66.51.159.115                     │
   │                                              │
   │   Room 4173   the employee app               │
   │   Room 4174   the client page                │
   │   Room 8000   the backend (does the thinking)│
   │                                              │
   └──────────────────────────────────────────────┘
```

**Those three rooms have no outside doors.** You cannot walk in from the street.
They are internal-only — which in computer terms is `127.0.0.1`, meaning
"reachable from inside this machine and nowhere else". Somebody in Karachi
cannot type `66.51.159.115:4173` and get in. The connection is refused before it
even starts.

## The receptionist

There is exactly **one** front door, and behind it sits a receptionist called
**nginx**.

```
                        🌍 the internet
                             │
                             ▼
              ╔══════════════════════════════╗
              ║        🛎️  nginx             ║   ← the ONLY public door
              ║   the receptionist            ║
              ╚══════════════════════════════╝
                    │        │        │
                    ▼        ▼        ▼
                 Room     Room     Room
                 4173     8000     4174
```

Every visitor talks to the receptionist. The receptionist walks them to the right
room. Nobody ever reaches a room directly.

## Two company names, one building

Here is the part that confuses people. You have two names:

```
priv.genetechsolutions.com       →  66.51.159.115
priv-req.genetechsolutions.com  →  66.51.159.115
```

**Both names point to the same building.** That is completely normal — like two
companies renting the same address. The postman brings letters for both to the
same door.

So how does the receptionist know which one you want?

## The name on the envelope

**Every visitor carries a letter, and the company name is written on it.**

When you type `priv.genetechsolutions.com` in your browser, the browser sends
this:

```
GET /create HTTP/1.1
Host: priv.genetechsolutions.com   ← the name on the envelope
```

That `Host:` line is written by the browser, from your address bar. **It is the
entire mechanism.** The receptionist reads it and looks it up on a list:

```
   Envelope says "priv."       →  Room 4173  (the employee app)
   Envelope says "priv-req."  →  Room 4174  (the client page)
```

That is all `server_name` in the nginx config means. A list of company names and
which room each one belongs to.

## Then: which floor?

Once the receptionist knows the company, they look at **what you asked for**:

```
   Anything starting with /api/   →  Room 8000  (the backend)
   Everything else                →  the company's own room
```

So it is a two-step lookup: **which name**, then **which path**. In the config
file that looks like:

```nginx
server {
    server_name priv.genetechsolutions.com;         ← WHICH NAME

    location /api/ { proxy_pass http://127.0.0.1:8000; }    ← WHICH PATH
    location /     { proxy_pass http://127.0.0.1:4173; }
}
```

`location /` means "everything else". It is the catch-all.

## Why does /api/ appear under BOTH names?

Because both websites need to talk to the same backend.

The employee app asks the backend "make me a secret". The client page asks the
backend "give me the secret for this token". Same backend, different questions.
So both companies in the building need directions to Room 8000.

And there is a bonus, which turns out to be important. Because `/api/` lives under
the **same name** as the page, the browser thinks the website and the API are
**the same place**. That means:

- 🍪 the login cookie is sent along automatically
- 🔓 no special browser permissions have to be switched on

If the API lived at a third name, you would have to relax browser security rules
to make it work. This way, you never do.

---

# Part 5 — Journey 1 — an employee makes a secret

Let us follow Sara, who works at Genetech and needs to send a database password
to a client.

### Step 1 — She opens the employee app

She types `https://priv.genetechsolutions.com` in her browser.

```
Sara's browser  →  "Host: priv.genetechsolutions.com, I want /"
                   │
                   ▼
              🛎️ nginx: "priv. — that's Room 4173."
                   │
                   ▼
              Room 4173 hands back dist/staff/index.html
```

She sees the login page.

### Step 2 — She logs in

She types her Genetech Windows password. The browser sends it to
`priv.genetechsolutions.com/api/auth/login`.

```
              🛎️ nginx: "priv. — and the path starts with /api/.
                         That's Room 8000."
                   │
                   ▼
              Room 8000 (the backend)
                   │
                   │  asks the Genetech domain controller
                   │  at 192.168.11.49: "is this her password?"
                   ▼
              Yes → here is a login cookie
```

She is in. She lands on the "create" page.

### Step 3 — She creates the secret

She types the password, picks "expires in 7 days", clicks create.

**Something important happens in her browser before anything is sent:** the secret
is **encrypted right there, on her laptop**. The server never sees the real
password. It only ever receives a scrambled blob it cannot read. (That is what
"zero-knowledge" means, and it is the whole point of the product.)

### Step 4 — The link appears

The backend saves the scrambled blob and hands back a link:

```
https://priv-req.genetechsolutions.com/s/AbC123xyz#K7mQ...
```

### 🛑 Stop here. This is the part everybody misunderstands.

Sara is on **priv.** But the link says **priv-req.**

**Nothing redirected her.** She was not moved anywhere. Her browser did not
navigate. She is still sitting on the priv. page.

The backend simply **wrote that text**. Here is the actual line of code
([routes_sender.py:108](Backend/routes_sender.py#L108)):

```python
url = f"{config.PUBLIC_BASE_URL}/s/{token}"
```

It glued together a setting from your `.env` file and the token. That is it. It is
just **text in a box on the screen, for Sara to copy.**

> Think of it as a business card. Sara is standing in the priv. office, and she
> hands you a card with the **priv-req.** address printed on it. She did not move.
> You did not move. Somebody just printed an address on a card.

The client goes to that address **later, separately, on their own.**

**Why this matters:** change `PUBLIC_BASE_URL` in `.env` and every future link
changes — no code edit, no nginx change, no restart of anything else. Get it wrong
and you will hand clients a link to your internal address, which still *works*,
which is exactly why nobody notices.

---

# Part 6 — Journey 2 — a client opens the link

Now Ahmed, at a completely different company, gets Sara's email.

### Step 1 — He clicks the link

```
Ahmed's browser  →  "Host: priv-req.genetechsolutions.com, I want /s/AbC123xyz"
                    │
                    ▼
               🛎️ nginx: "priv-req. — that's Room 4174."
                    │
                    ▼
               Room 4174 hands back dist/public/index.html
```

He gets the **client page**. Notice what he did **not** get: no login form, no
dashboard, no admin log. That code **is not in the folder.** It was deleted at
build time.

### Step 2 — The page asks for the secret

The page calls `priv-req.genetechsolutions.com/api/s/AbC123xyz/meta`.

```
               🛎️ nginx: "priv-req. — path starts with /api/. Room 8000."
                    │
                    ▼
               Room 8000 → here is the scrambled blob
```

### Step 3 — His browser unscrambles it

Look at the link again:

```
https://priv-req.genetechsolutions.com/s/AbC123xyz#K7mQ...
                                              ▲
                                              │
                                    everything after the #
```

**The part after `#` is never sent to the server.** That is a rule built into
every browser on earth. It stays in the address bar, on Ahmed's machine.

And that part **is the decryption key.**

So:

- the **server** has the scrambled blob but no key
- **Ahmed's browser** gets the key from the address bar and unscrambles it locally

The server never had the ability to read the secret. Not "was not allowed to" —
**could not.**

### Step 4 — It self-destructs

The moment it is read, the backend deletes it. Ahmed refreshes the page and gets
"already viewed". Sara sees "viewed at 14:32" on her dashboard.

### Step 5 — What Ahmed can never do

Ahmed types `https://priv-req.genetechsolutions.com/create` out of curiosity.

He gets a **"page not found"** — because `dist/public` has no create page in it.
There is nothing to load. He is not being blocked by a rule that somebody could
misconfigure; the code is simply not there.

---

# Part 7 — Your laptop vs the server, side by side

**This is the answer to your question.** Your laptop and the server are genuinely
different, and that is not a mistake.

```
╔═══════════════════════════════════╗   ╔═══════════════════════════════════╗
║        YOUR LAPTOP                ║   ║          THE SERVER               ║
║        npm run dev                ║   ║          npm run build            ║
╠═══════════════════════════════════╣   ╠═══════════════════════════════════╣
║                                   ║   ║                                   ║
║   ONE program: Vite               ║   ║   THREE programs:                 ║
║   ONE port: 5173                  ║   ║     serve  → 4173                 ║
║   ONE website (the staff one)     ║   ║     serve  → 4174                 ║
║                                   ║   ║     uvicorn→ 8000                 ║
║   NO folders built                ║   ║   plus nginx on 443               ║
║   NO nginx                        ║   ║                                   ║
║   NO domain names                 ║   ║   TWO folders built               ║
║                                   ║   ║   TWO domain names                ║
╚═══════════════════════════════════╝   ╚═══════════════════════════════════╝
```

## So how do you test a client link on your laptop?

Remember the table in Part 2: **the staff folder contains the client pages too.**
The dev server runs the staff build, so `/s/<token>` works right there on 5173.
Look at the routes ([staff.tsx:81](Frontend/src/routes/staff.tsx#L81)):

```jsx
{/* Client-facing pages, unauthenticated even here. */}
<Route path="/s/:token" element={<PublicShell><Reveal /></PublicShell>} />
<Route path="/r/:token" element={<PublicShell><RequestSubmit /></PublicShell>} />
```

So on your laptop, **one address does everything**:

```
http://localhost:5173/create        ← works
http://localhost:5173/s/<token>     ← also works
```

### Which is why, on your laptop, both settings are the same number:

```ini
FRONTEND_ORIGIN=http://localhost:5173
PUBLIC_BASE_URL=http://localhost:5173     ← SAME. Not 5174.
```

**If you write 5174 here, your links will be dead.** Not because of a bug —
because **nothing is running on 5174.** No program opened it. Remember Part 3: a
port is a program, and you only started one program.

`.env` does not create servers. It only prints text. Writing `5174` there is like
writing a fake address on an envelope and wondering why the letter came back.

---

# Part 8 — The `.env` file, line by line

On the server, only these lines really need thinking about.

```ini
ENV=production
```
Turns on the security features: secure cookies, forced HTTPS, and it hides the
API documentation page. **It also makes HTTPS mandatory** — see the warning below.

```ini
FRONTEND_ORIGIN=https://priv.genetechsolutions.com
```
"Where do my employees work?" Used to check that requests really came from your
own app. Get this wrong and staff actions fail **only in a browser** — testing
with `curl` shows nothing wrong, which makes it maddening to debug.

```ini
PUBLIC_BASE_URL=https://priv-req.genetechsolutions.com
```
"What address do I print on the business card?" This is the one from Part 5. **The
single most important line to check after deploying.**

```ini
ALLOWED_HOSTS=priv.genetechsolutions.com,priv-req.genetechsolutions.com,backend
```
"Which names am I willing to answer to?" **Both** must be listed. Miss one and
every request to that name returns a blank `400 Invalid host header` — with
nothing in the logs. It looks exactly like the server is down.

```ini
DB_PASSWORD=...
APP_DB_PASSWORD=...
```
⚠️ **Read only ONCE**, the very first time the database starts. Changing them
later does nothing to the database — it just stops the app connecting. Set them
before you start anything.

```ini
PASSWORD_PEPPER=...
```
⚠️ **Set it now or never.** It is mixed into every stored password. Adding it
later invalidates every existing account, including your emergency one.

> ### 🔴 Notice what is NOT in this file
>
> **4173 and 4174 appear nowhere in `.env`.** Not once.
>
> `.env` describes what a **browser** types. 4173 and 4174 are internal room
> numbers that only nginx and PM2 know about. They live in exactly two files —
> `ecosystem.config.cjs` and `nginx.conf` — and nowhere else.

> ### 🔴 And HTTPS is not optional
>
> `ENV=production` makes the browser refuse to keep the login cookie over plain
> `http://`. Login will loop forever, while the API cheerfully returns "success"
> for everything. **Do not try to "test it on HTTP first."** That failure is
> guaranteed and looks exactly like a bug in the login code.

---

# Part 9 — Deploy — from `git clone` to done

Every command, in order. Paste one block at a time and read what it says back.

## Before you start: the two DNS records

Do this first — it can take an hour to spread across the internet, and Step 8 will
refuse to run until it has.

| Type | Name | Value |
|---|---|---|
| A | `secure` | `66.51.159.115` |
| A | `share` | `66.51.159.115` |

---

## Step 1 — Get the code

```bash
cd ~
git clone https://github.com/genetech/secureshare.git
cd secureshare
ls
```

You should see `Backend`, `Frontend`, `deploy`, `docker-compose.yml`.

## Step 2 — Install the tools

```bash
sudo apt update
sudo apt install -y curl git ufw nginx certbot python3-certbot-nginx dnsutils
```

Docker (runs the backend and the databases):

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo systemctl enable --now docker
sudo usermod -aG docker $USER
```

**Now log out of Bitvise and log back in.** That last command only takes effect on
a fresh login. Then check:

```bash
docker ps          # an empty table, NOT "permission denied"
```

Node (builds the two folders) and PM2 (keeps `serve` running):

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2 serve
node -v            # must be v22.x
```

Firewall — allow SSH **before** turning it on, or you lock yourself out of the
window you are typing in:

```bash
sudo ufw allow 4022/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
```

## Step 3 — Make the settings file

```bash
cd ~/secureshare
for i in 1 2 3 4; do openssl rand -base64 24; done
```

Four random passwords appear. Keep them on screen, then:

```bash
cp deploy/env.production.example .env
nano .env
```

Replace every `REPLACE_...` with one of those random values, and put the real AD
password in. Save with `Ctrl+O`, `Enter`, `Ctrl+X`. Then check:

```bash
grep REPLACE_ .env     # must print NOTHING
```

## Step 4 — Close the database doors

Out of the box, the database is reachable from the whole internet. Fix that:

```bash
sed -i 's|^\( *- \)"5432:5432"|\1"127.0.0.1:5432:5432"|' docker-compose.yml
sed -i 's|^\( *- \)"6379:6379"|\1"127.0.0.1:6379:6379"|' docker-compose.yml
sed -i 's|^\( *- \)"8000:8000"|\1"127.0.0.1:8000:8000"|' docker-compose.yml

grep -c '127.0.0.1:' docker-compose.yml     # must print 3
```

If it does not print `3`, stop and tell me.

## Step 5 — Make a shortcut

You will type this pair of files constantly. Make it one word:

```bash
echo "alias dc='docker compose -f ~/secureshare/docker-compose.yml -f ~/secureshare/docker-compose.prod.yml'" >> ~/.bashrc
source ~/.bashrc
```

Check the settings came out right:

```bash
cd ~/secureshare
dc config | grep -E 'ENV:|ALLOWED_HOSTS:'
```

## Step 6 — Start the backend

```bash
dc up -d --build
```

First time takes a few minutes. Then:

```bash
dc ps                                                    # three services running
curl -s -H 'Host: backend' http://127.0.0.1:8000/api/health
```

You want: `{"ok":true,"postgres":true,"redis":true}`

**Room 8000 now exists.** ✅

## Step 7 — Build the folders and open rooms 4173 and 4174

```bash
cd ~/secureshare/Frontend
npm ci
npm run build
```

**This is Part 2 happening for real.** Check both folders appeared:

```bash
ls dist/staff/index.html dist/public/index.html
```

Now start the two programs that open the two ports — **this is Part 3 happening
for real**:

```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 list
```

Both must say **online**. Then:

```bash
pm2 startup
```

> ⚠️ That command **prints another command** starting with `sudo env PATH=...`.
> **Copy that printed line and run it.** It is what makes PM2 restart after a
> reboot. Skip it and both websites die the first time the server restarts.

Check the rooms are open:

```bash
curl -sI http://127.0.0.1:4173 | head -1     # 200 OK
curl -sI http://127.0.0.1:4174 | head -1     # 200 OK
```

**Rooms 4173 and 4174 now exist.** ✅

## Step 8 — Hire the receptionist

```bash
cd ~/secureshare
sudo cp deploy/nginx.conf /etc/nginx/sites-available/secureshare
sudo ln -sf /etc/nginx/sites-available/secureshare /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
```

`nginx -t` checks the file for mistakes **while the old settings are still
running**, so a typo cannot take the site down. Only when it says "successful":

```bash
sudo systemctl reload nginx
```

### Test the receptionist before DNS is even involved

You can fake the name on the envelope with `curl -H`. This tests Part 4 directly:

```bash
curl -sI -H 'Host: priv.genetechsolutions.com' http://127.0.0.1/ | head -1
curl -sI -H 'Host: priv-req.genetechsolutions.com' http://127.0.0.1/ | head -1
```

Both should say `200 OK`. If they do, **the routing works.**

## Step 9 — Add the padlock

Check DNS has arrived first:

```bash
dig +short priv.genetechsolutions.com
dig +short priv-req.genetechsolutions.com
```

Both must print `66.51.159.115`. **If not, wait. Do not run the next command** —
it will fail and count against a limit.

```bash
sudo certbot --nginx \
  -d priv.genetechsolutions.com \
  -d priv-req.genetechsolutions.com \
  --agree-tos -m webadmin@genetech.co --redirect --non-interactive
```

One certificate, both names, renews itself forever. certbot edits your nginx file
for you — you do not write any of it.

## Step 10 — Create the first account

There is no signup page anywhere, on purpose. The only way in is this:

```bash
cd ~/secureshare
dc exec backend python manage.py adduser you@genetechsolutions.com --admin
dc exec backend python manage.py list
```

And fetch the certificate the backend needs to trust your domain controller:

```bash
dc exec backend python manage.py export-ad-ca --out /tmp/ca.pem
dc cp backend:/tmp/ca.pem ./Backend/certs/genetech-ca.pem
dc restart backend
```

## Step 11 — Try it

1. Open `https://priv.genetechsolutions.com` — log in.
2. Create a secret. **The link must start with `https://priv-req.`**
   If it says `priv.`, fix `PUBLIC_BASE_URL` in `.env` and run `dc up -d`.
3. Open that link in a private window. It shows the secret **once**.
4. Open it again — "already viewed". ✅
5. Go to `https://priv-req.genetechsolutions.com/create` — **page not found**. ✅
6. Reboot the server, wait a minute, and check everything came back:

```bash
sudo reboot
# reconnect, then:
pm2 list
cd ~/secureshare && dc ps
```

Step 6 is the one people skip. It is the only real test of `pm2 startup`.

---

# Part 10 — When it breaks

Every one of these has a confusing symptom and a simple cause.

### 502 Bad Gateway

The receptionist knocked on a room and nobody answered.

```bash
pm2 list      # is it online?
```

If PM2 is fine, the room numbers disagree. Check both halves match:

```bash
grep PORT Frontend/ecosystem.config.cjs
grep proxy_pass deploy/nginx.conf
```

`4173` and `4174` must appear in both.

### "Welcome to nginx!"

You forgot to remove the default site, and it is answering for every name.

```bash
sudo rm -f /etc/nginx/sites-enabled/default
sudo systemctl reload nginx
```

### 400 Invalid host header

You are knocking with a name the backend does not recognise. Add it to
`ALLOWED_HOSTS` in `.env`, then `dc up -d`.

### Login works, then immediately logs out again

You are on `http://` instead of `https://`. The browser is throwing the cookie
away. Finish Step 9.

### The generated link points at `priv.` instead of `priv-req.`

`PUBLIC_BASE_URL` is wrong. Fix `.env`, run `dc up -d`. Old links keep the old
address; new ones are correct.

### The staff site shows a page with no login on it

`Frontend/.env.staff` is missing, so both folders were built as the public one.

```bash
cat Frontend/.env.staff        # must say VITE_SURFACE=staff
npm run build && pm2 restart all
```

### Employees cannot log in, but everything else works

The backend cannot reach the domain controller.

```bash
ping -c2 192.168.11.49
openssl s_client -connect 192.168.11.49:636 -brief </dev/null
dc logs --tail 30 backend
```

---

# The whole thing in ten lines

1. `npm run dev` = one program, one port, on your laptop only.
2. `npm run build` = two folders, no ports, on the server.
3. `dist/staff` is the employee app. `dist/public` is the client page.
4. A folder cannot serve itself, so PM2 starts one `serve` per folder.
5. Each `serve` opens a port. **That is where 4173 and 4174 come from.**
6. 5173 is the laptop dev port. 5174 was never real.
7. Both domain names point at the same machine.
8. nginx reads the name on the envelope (`Host:`) and picks the room.
9. `/api/` from either name goes to room 8000.
10. `.env` prints text. It does not open ports.

---

*SecureShare — built by Genetech Solutions. Your AI Solution Partner.*
